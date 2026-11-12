import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { statement } from "@kaneo/permissions";
import { HTTPException } from "hono/http-exception";
import platformDb from "../../database";
import {
  projectTable,
  taskTable,
  teamTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import { findInaccessibleProjectIds } from "../../project-access/find-inaccessible-project-ids";
import { roleHasWorkspacePermission } from "../../utils/require-workspace-permission";
import { hasInstanceAdminRole } from "../../utils/instance-admin-role";
import type { QuillsAction } from "../with-quills-request";
import { listAccessibleProjectIds } from "../../project-access/list-accessible-project-ids";
import { requireWorkspaceEntitlement } from "../../billing/controllers/require-entitlement";

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
) {
  const readers = new Map<string, { email: string }>();
  const ids = [...new Set(userIds)];
  if (!ids.length) return readers;
  const rows = await platformDb
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
    );
  for (const row of rows)
    if (
      await roleHasWorkspacePermission(workspaceId, row.role, {
        workspace: ["read"],
        quills: ["read"],
      })
    )
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
    roleHasWorkspacePermission(workspaceId, row.memberRole, {
      workspace: ["read"],
      quills: [action],
    })
  );
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
export async function isMemberOfNamedWorkspace(
  workspace: string,
  userId: string,
) {
  const named = platformDb
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
 * The Kaneo account behind a portal customer, for a delivery decision at send time: the shape of
 * framework/audience.ts#PortalAccount. Undefined for a missing or banned account. Workers only.
 */
export async function portalAccount(workspaceId: string, userId: string) {
  const [row] = await platformDb
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      emailVerified: userTable.emailVerified,
      image: userTable.image,
      // ${userTable}.id, not ${userTable.id}: in a one-table select, drizzle writes the column as a
      // bare "id", which the subquery would bind to workspace_member.id.
      member: sql<boolean>`exists (select 1 from ${workspaceUserTable} where ${workspaceUserTable.workspaceId} = ${workspaceId} and ${workspaceUserTable.userId} = ${userTable}.id)`,
    })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, userId),
        sql`coalesce(${userTable.banned},false)=false`,
      ),
    )
    .limit(1);
  return row && { ...row, name: row.name || row.email.split("@")[0]! };
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
  const held: (typeof statement.quills)[number][] = [];
  if (member)
    for (const action of statement.quills)
      if (
        await roleHasWorkspacePermission(workspaceId, member.role, {
          workspace: ["read"],
          quills: [action],
        })
      )
        held.push(action);
  return held;
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
