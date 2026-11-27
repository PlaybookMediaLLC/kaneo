import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { statement } from "@kaneo/permissions";
import db from "../database";
import { projectTable } from "../database/schema";
import {
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../database/quills/client";
import { assertProjectAccess } from "../project-access/assert-project-access";
import {
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export type QuillsAction = (typeof statement.quills)[number];

/**
 * Project IDs must come from the feature's persisted relationship, never a caller's substitute.
 * A function project ID runs after the permission checks, so a denied caller learns nothing from its lookup.
 */
export async function withQuillsRequest<T>(
  c: Context,
  access: {
    action: QuillsAction;
    /** Further Quills actions that the caller must also hold (role and API-key scope). */
    also?: readonly QuillsAction[];
    projectId?: string | (() => Promise<string | undefined>);
    /** True on GET routes so withQuillsWorkspace skips FOR SHARE row locks. */
    readOnly?: boolean;
    /** True when defineQuillsRoute already ran workspaceAccess.fromParam on this request. */
    workspaceAccessChecked?: boolean;
    /** Receives every Quills action the caller holds, computed in the same permission lookup. */
    onActions?: (actions: ReadonlySet<QuillsAction>) => void;
  },
  work: (db: Database, actor: QuillsActor) => Promise<T>,
): Promise<T> {
  const userId = c.get("userId") as string | undefined;
  const workspaceId = c.get("workspaceId") as string | undefined;
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  if (!workspaceId)
    throw new HTTPException(400, { message: "Workspace is required" });
  if (!access.workspaceAccessChecked)
    await validateWorkspaceAccess(userId, workspaceId, c.get("apiKey")?.id);
  const required = {
    workspace: ["read"] as string[],
    quills: [access.action, ...(access.also ?? [])] as string[],
  };
  if (access.onActions) {
    const can = await workspacePermissionChecker(c);
    if (!can(required))
      // Delegate denial so API_KEY_SCOPE / MISSING_PERMISSION error bodies stay identical.
      await requireWorkspacePermission(required)(c, async () => {});
    access.onActions(
      new Set(
        statement.quills.filter((action) =>
          can({ workspace: ["read"], quills: [action] }),
        ),
      ),
    );
  } else {
    await requireWorkspacePermission(required)(c, async () => {});
  }
  const projectId =
    typeof access.projectId === "function"
      ? await access.projectId()
      : access.projectId;
  if (projectId) {
    const [project] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    await assertProjectAccess(userId, project.id);
  }
  return withQuillsWorkspace({ userId, workspaceId }, work, {
    readOnly: access.readOnly,
  });
}
