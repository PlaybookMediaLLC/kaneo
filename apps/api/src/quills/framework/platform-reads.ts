import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { statement } from "@kaneo/permissions";
import { HTTPException } from "hono/http-exception";
import platformDb from "../../database";
import {
  accountTable,
  columnTable,
  projectTable,
  taskTable,
  teamTable,
  userTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import { assertAssignableUser } from "../../utils/assert-assignable-user";
import { rolesAllow, type PermissionMap } from "../../utils/role-permissions";
import { findInaccessibleProjectIds } from "../../project-access/find-inaccessible-project-ids";
import { roleHasWorkspacePermission } from "../../utils/require-workspace-permission";
import { splitRoles } from "../../utils/split-roles";
import { hasInstanceAdminRole } from "../../utils/instance-admin-role";
import { PORTAL_TOKEN_PROVIDER } from "./portal-sign-in";
import type { QuillsAction } from "../with-quills-request";
import { listAccessibleProjectIds } from "../../project-access/list-accessible-project-ids";
import { requireWorkspaceEntitlement } from "../../billing/controllers/require-entitlement";
import { taskIsCompleted } from "../../task/task-is-completed";

// The only module that reads public tables for Quills routes. Every read filters on workspaceId.

/** The task's stored project. 404 when the task is not in this workspace. */
export async function taskProjectId(workspaceId: string, taskId: string) {
  const [task] = await platformDb
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(eq(taskTable.id, taskId), eq(projectTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!task?.projectId)
    throw new HTTPException(404, { message: "Task not found" });
  return task.projectId;
}

/**
 * The workspace of a task that is in a done column now (task sync, RFC 0003 D12). With
 * `workspaceId`, the task must also be in that workspace. Undefined for a task that is not done,
 * deleted or in another workspace. Without `workspaceId`, it serves only Kaneo's own handoff of a
 * committed task change, never a caller-supplied ID.
 */
export async function doneTaskWorkspace(taskId: string, workspaceId?: string) {
  const [task] = await platformDb
    .select({ workspaceId: projectTable.workspaceId })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, taskId),
        taskIsCompleted,
        workspaceId ? eq(projectTable.workspaceId, workspaceId) : undefined,
      ),
    )
    .limit(1);
  return task?.workspaceId;
}

/** A Kaneo team of this workspace. 404 otherwise. */
export async function canonicalTeam(workspaceId: string, id: string) {
  const [team] = await platformDb
    .select({ id: teamTable.id, name: teamTable.name })
    .from(teamTable)
    .where(and(eq(teamTable.id, id), eq(teamTable.workspaceId, workspaceId)))
    .limit(1);
  if (!team) throw new HTTPException(404, { message: "Team not found" });
  return team;
}

/** The current members of this workspace and their Kaneo roles. */
export async function workspaceMembers(workspaceId: string) {
  // ponytail: loads the whole roster; page it when workspaces reach thousands of members.
  return platformDb
    .select({
      userId: workspaceUserTable.userId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
}

/** The Kaneo user IDs of this workspace's current members. */
export async function memberUserIds(workspaceId: string) {
  return (await workspaceMembers(workspaceId)).map((row) => row.userId);
}

type Links = {
  nextOffset: number | null;
  boards: { boardId: string; projectId: string }[];
  posts: { postId: string; taskId: string }[];
};

/**
 * Trims a page read with one extra row per list, then removes links whose project
 * or task left this workspace or is hidden from the user.
 */
export async function visibleLinks(
  rows: Links,
  { offset, limit }: { offset: number; limit: number },
  workspaceId: string,
  userId: string,
): Promise<Links> {
  const page = {
    nextOffset:
      rows.boards.length > limit || rows.posts.length > limit
        ? offset + limit
        : null,
    boards: rows.boards.slice(0, limit),
    posts: rows.posts.slice(0, limit),
  };
  const taskIds = [...new Set(page.posts.map((p) => p.taskId))];
  const tasks = taskIds.length
    ? await platformDb
        .select({ id: taskTable.id, projectId: taskTable.projectId })
        .from(taskTable)
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(
          and(
            inArray(taskTable.id, taskIds),
            eq(projectTable.workspaceId, workspaceId),
          ),
        )
    : [];
  const projectIds = [...new Set(page.boards.map((b) => b.projectId))];
  const projects = projectIds.length
    ? await platformDb
        .select({ id: projectTable.id })
        .from(projectTable)
        .where(
          and(
            inArray(projectTable.id, projectIds),
            eq(projectTable.workspaceId, workspaceId),
          ),
        )
    : [];
  const present = new Set(projects.map((p) => p.id));
  const denied = new Set(
    await findInaccessibleProjectIds(userId, [
      ...page.boards.map((b) => b.projectId),
      ...tasks.flatMap((t) => (t.projectId ? [t.projectId] : [])),
    ]),
  );
  const allowedTasks = new Set(
    tasks
      .filter((t) => t.projectId && !denied.has(t.projectId))
      .map((t) => t.id),
  );
  return {
    nextOffset: page.nextOffset,
    boards: page.boards.filter(
      (b) => present.has(b.projectId) && !denied.has(b.projectId),
    ),
    posts: page.posts.filter((p) => allowedTasks.has(p.taskId)),
  };
}

/** Current, unbanned members of this workspace who may read Quills, with their address. */
export async function quillsReaders(
  workspaceId: string,
  userIds: readonly string[],
  actions: readonly QuillsAction[] = ["read"],
) {
  const readers = new Map<string, { email: string }>();
  const ids = [...new Set(userIds)];
  if (!ids.length) return readers;
  const [rows, storedRoles] = await Promise.all([
    platformDb
      .select({
        userId: workspaceUserTable.userId,
        role: workspaceUserTable.role,
        email: userTable.email,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(
        and(
          eq(workspaceUserTable.workspaceId, workspaceId),
          inArray(workspaceUserTable.userId, ids),
          sql`coalesce(${userTable.banned},false)=false`,
        ),
      ),
    platformDb
      .select({
        role: workspaceRoleTable.role,
        permission: workspaceRoleTable.permission,
      })
      .from(workspaceRoleTable)
      .where(eq(workspaceRoleTable.workspaceId, workspaceId)),
  ]);
  const required = {
    workspace: ["read"],
    quills: [...actions],
  };
  for (const row of rows)
    if (rolesAllow(splitRoles(row.role), storedRoles, required))
      readers.set(row.userId, { email: row.email });
  return readers;
}

/**
 * Whether the user may take a Quills action in this workspace now, by the request rules with no
 * request: an unbanned account that is an instance administrator, or a current member whose
 * Kaneo role grants workspace:read and the action. Automation re-checks its acting teammate here.
 */
export async function teammateMayAct(
  workspaceId: string,
  userId: string,
  action: QuillsAction,
) {
  return teammateHolds(workspaceId, userId, {
    workspace: ["read"],
    quills: [action],
  });
}

/**
 * The projects of this workspace that the user can open, by Kaneo's own project-access rule. A board linked
 * to projects is visible only when one of them is in this list (see feedback/visibility.ts).
 * Read before or after a Quills transaction, never inside one.
 */
export async function accessibleProjectIds(
  workspaceId: string,
  userId: string,
): Promise<string[]> {
  return [...(await listAccessibleProjectIds(platformDb, workspaceId, userId))];
}

/**
 * True when the Kaneo account is a member of the workspace that `workspace` (an ID or slug, an
 * ID match winning) names. Read before the scoped transaction, so a request never holds two
 * connections. Only the private-portal team grant reads it; it is not a Quills permission.
 */
/** The ID of the workspace a portal or widget caller names, as a subquery. */
const namedWorkspaceId = (workspace: string) =>
  platformDb
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    // The same choice as withQuillsAudience: an unarchived workspace, an ID match first.
    .where(
      and(
        or(
          eq(workspaceTable.id, workspace),
          eq(workspaceTable.slug, workspace),
        ),
        isNull(workspaceTable.archivedAt),
      ),
    )
    .orderBy(sql`${workspaceTable.id} = ${workspace} desc`)
    .limit(1);

export async function isMemberOfNamedWorkspace(
  workspace: string,
  userId: string,
) {
  const named = namedWorkspaceId(workspace);
  const [row] = await platformDb
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, sql`(${named})`),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The workspace customer that a portal token sign-in created this Kaneo account for (gaps G-17 and
 * G-24): its "quills-portal" account row names `<workspace>:<customer>`. Null for any other account.
 */
export async function tokenCustomerOfNamedWorkspace(
  workspace: string,
  userId: string,
) {
  const [row] = await platformDb
    .select({ accountId: accountTable.accountId })
    .from(accountTable)
    .where(
      and(
        eq(accountTable.userId, userId),
        eq(accountTable.providerId, PORTAL_TOKEN_PROVIDER),
        sql`${accountTable.accountId} like (${namedWorkspaceId(workspace)}) || ':%'`,
      ),
    )
    .limit(1);
  return row ? row.accountId.slice(row.accountId.indexOf(":") + 1) : null;
}

/**
 * The Kaneo account behind a portal customer, for a delivery decision at send time: the shape of
 * framework/audience.ts#PortalAccount. Undefined for a missing or banned account. Workers only.
 */
export async function portalAccount(workspaceId: string, userId: string) {
  return (await portalAccounts(workspaceId, [userId])).get(userId);
}

/** Batched lookup of unbanned portal accounts for a workspace in 1 query. Workers only. */
export async function portalAccounts(
  workspaceId: string,
  userIds: readonly string[],
) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await platformDb
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      emailVerified: userTable.emailVerified,
      image: userTable.image,
      member: sql<boolean>`exists (select 1 from ${workspaceUserTable} where ${workspaceUserTable.workspaceId} = ${workspaceId} and ${workspaceUserTable.userId} = ${userTable}.id)`,
    })
    .from(userTable)
    .where(
      and(
        inArray(userTable.id, unique),
        sql`coalesce(${userTable.banned},false)=false`,
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      { ...row, name: row.name || row.email.split("@")[0]! },
    ]),
  );
}

/**
 * Kaneo's plan check for paid Quills features: 402 when the workspace's Kaneo Cloud plan is not active.
 * A no-op when billing is off, so self-hosted installs are never gated. It can create the workspace's billing row.
 */
export { requireWorkspaceEntitlement };

/**
 * The Quills actions that a current, unbanned member's role grants now; none for anyone else.
 * A worker re-checks a requester with it before it acts on that person's behalf.
 */
export async function memberQuillsActions(workspaceId: string, userId: string) {
  const [member] = await platformDb
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
        sql`coalesce(${userTable.banned},false)=false`,
      ),
    );
  if (!member) return [];
  const roles = splitRoles(member.role);
  const storedRoles = roles.length
    ? await platformDb
        .select({
          role: workspaceRoleTable.role,
          permission: workspaceRoleTable.permission,
        })
        .from(workspaceRoleTable)
        .where(
          and(
            eq(workspaceRoleTable.workspaceId, workspaceId),
            inArray(workspaceRoleTable.role, roles),
          ),
        )
    : [];
  return statement.quills.filter((action) =>
    rolesAllow(roles, storedRoles, {
      workspace: ["read"],
      quills: [action],
    }),
  );
}

/**
 * The Kaneo user ID of the one current, unbanned member of this workspace whose verified account email
 * is `email`, or null. It names an account for an external identity (a Slack profile email); the
 * caller still checks that account's Quills actions with memberQuillsActions.
 */
export async function memberByVerifiedEmail(
  workspaceId: string,
  email: string,
) {
  const rows = await platformDb
    .select({ userId: userTable.id })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        sql`lower(${userTable.email}) = ${email.trim().toLowerCase()}`,
        eq(userTable.emailVerified, true),
        sql`coalesce(${userTable.banned},false)=false`,
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]!.userId : null;
}

/** Whether Kaneo's plan check passes, for a read that shows an upgrade prompt. */
export async function hasWorkspaceEntitlement(workspaceId: string) {
  try {
    await requireWorkspaceEntitlement(workspaceId);
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 402) return false;
    throw error;
  }
}

/**
 * Whether the account may take a Quills action in an unarchived workspace: a member whose role holds
 * `workspace:read` and the action, or an instance administrator (Kaneo's existing override). There is
 * no API key on this path: a signed OAuth redirect carries the session cookie only.
 */
export async function memberHoldsQuillsAction(
  workspaceId: string,
  userId: string,
  action: string,
) {
  const [row] = await platformDb
    .select({ role: workspaceUserTable.role, userRole: userTable.role })
    .from(userTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, workspaceId))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .where(and(eq(userTable.id, userId), isNull(workspaceTable.archivedAt)))
    .limit(1);
  if (!row) return false;
  if (hasInstanceAdminRole(row.userRole)) return true;
  return row.role
    ? roleHasWorkspacePermission(workspaceId, row.role, {
        workspace: ["read"],
        quills: [action],
      })
    : false;
}

/**
 * Whether the account holds the Kaneo permissions in this workspace now, by Kaneo's rules without a
 * request: an unbanned instance administrator, or a member whose role grants them. A worker that
 * acts as a teammate checks it; a request checks the same through route middleware.
 */
export async function teammateHolds(
  workspaceId: string,
  userId: string,
  permissions: PermissionMap,
) {
  const [row] = await platformDb
    .select({
      role: userTable.role,
      banned: userTable.banned,
      memberRole: workspaceUserTable.role,
    })
    .from(userTable)
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, userTable.id),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!row || row.banned) return false;
  if (hasInstanceAdminRole(row.role)) return true;
  return (
    row.memberRole !== null &&
    roleHasWorkspacePermission(workspaceId, row.memberRole, permissions)
  );
}

/** Why a teammate cannot create a Kaneo task from a request (RFC 0005, 5.2). Safe to show to that teammate. */
export const TASK_FAILURES = [
  "forbidden",
  "archived",
  "column_missing",
  "plan",
  "failed",
] as const;
export type TaskFailure = (typeof TASK_FAILURES)[number];

/**
 * The column slug to create a task in, as the teammate, or why they cannot: Kaneo task:create, project
 * access, a live project of this workspace, Kaneo's plan check and the column. A null column is the
 * project's first open column. Kaneo's createTask route checks the same before its controller runs.
 */
export async function taskTarget(
  workspaceId: string,
  userId: string,
  projectId: string,
  columnId: string | null,
): Promise<{ status: string } | { reason: TaskFailure }> {
  const [project] = await platformDb
    .select({ archivedAt: projectTable.archivedAt })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (
    !project ||
    !(await teammateHolds(workspaceId, userId, { task: ["create"] })) ||
    !(await listAccessibleProjectIds(platformDb, workspaceId, userId)).has(
      projectId,
    )
  )
    return { reason: "forbidden" };
  if (project.archivedAt) return { reason: "archived" };
  if (!(await hasWorkspaceEntitlement(workspaceId))) return { reason: "plan" };
  const columns = await platformDb
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(columnTable.position, columnTable.id);
  const column = columnId
    ? columns.find((one) => one.id === columnId)
    : columns.find((one) => !one.isFinal);
  return column ? { status: column.slug } : { reason: "column_missing" };
}

/** Whether Kaneo lets the user be the assignee of a task in the project. */
export async function assignable(
  workspaceId: string,
  projectId: string,
  userId: string,
) {
  try {
    await assertAssignableUser(userId, workspaceId, projectId);
    return true;
  } catch (error) {
    if (error instanceof HTTPException) return false;
    throw error;
  }
}

/**
 * The linked tasks of this workspace that the user can open, with their key, column and assignee,
 * and how many others the user cannot open. A task that left the workspace counts as neither.
 */
export async function linkedTasks(
  workspaceId: string,
  userId: string,
  taskIds: readonly string[],
) {
  const rows = taskIds.length
    ? await platformDb
        .select({
          taskId: taskTable.id,
          title: taskTable.title,
          number: taskTable.number,
          projectId: taskTable.projectId,
          projectSlug: projectTable.slug,
          columnName: columnTable.name,
          columnColor: columnTable.color,
          done: sql<boolean>`coalesce(${columnTable.isFinal}, false)`,
          assigneeName: userTable.name,
        })
        .from(taskTable)
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .leftJoin(columnTable, eq(columnTable.id, taskTable.columnId))
        .leftJoin(userTable, eq(userTable.id, taskTable.userId))
        .where(
          and(
            inArray(taskTable.id, [...taskIds]),
            eq(projectTable.workspaceId, workspaceId),
          ),
        )
    : [];
  const open = rows.length
    ? await listAccessibleProjectIds(platformDb, workspaceId, userId)
    : new Set<string>();
  const visible = rows.filter((row) => open.has(row.projectId));
  return {
    items: visible.map(({ projectSlug, number, ...row }) => ({
      ...row,
      key: number ? `${projectSlug}-${number}` : null,
    })),
    hidden: rows.length - visible.length,
  };
}

/**
 * The newest task of the workspace's project, created in the last day, whose description contains
 * `marker` (a request's URL): the rule's task when an attempt stopped before its link write.
 */
export async function recentTaskWithMarker(
  workspaceId: string,
  projectId: string,
  marker: string,
) {
  const [task] = await platformDb
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(projectTable.workspaceId, workspaceId),
        sql`strpos(${taskTable.description}, ${marker}) > 0`,
        sql`${taskTable.createdAt} > now() - interval '1 day'`,
      ),
    )
    .orderBy(sql`${taskTable.createdAt} desc`)
    .limit(1);
  return task?.id;
}
