// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { teamMembers } from "../../database/quills/schema/teams";
import type { Database, QuillsActor } from "../framework/define-route";

/**
 * Resolves optional per-team read/comment scoping for limited roles (e.g. free
 * collaborators who lack `quills:update`).
 *
 * - Full agents (`quills:update`) always get `null` (workspace-wide visibility).
 * - Limited callers assigned to one or more Quills teams get those team IDs and
 *   only see conversations/tickets assigned to their teams.
 * - Limited callers not assigned to any team get `null` (workspace-wide visibility).
 */
export async function resolveAllowedTeamIds(
  db: Database,
  workspaceId: string,
  actor: QuillsActor,
  callerActions: ReadonlySet<string>,
): Promise<TypeId<"team">[] | null> {
  if (callerActions.has("update")) return null;
  if (!actor.principalId) return null;
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.workspaceId, workspaceId),
        eq(teamMembers.principalId, actor.principalId),
      ),
    );
  return rows.length > 0 ? rows.map((row) => row.teamId) : null;
}

export function assertTeamVisible(
  allowedTeamIds: readonly TypeId<"team">[] | null,
  resourceTeamId: TypeId<"team"> | null | undefined,
  kind: "Conversation" | "Ticket" | "File",
): void {
  if (!allowedTeamIds) return;
  if (resourceTeamId && allowedTeamIds.includes(resourceTeamId)) return;
  throw new HTTPException(404, { message: `${kind} not found` });
}
