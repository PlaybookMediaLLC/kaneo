import { and, eq, inArray, or } from "drizzle-orm";
import db, { schema } from "../database";

export const TEAM_MEMBER_ROLES = ["lead", "member", "observer"] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

/**
 * Returns true if `userId` may view or access `teamId` (#306).
 * Public teams (`isPrivate = false`) are visible to workspace members.
 * Private teams (`isPrivate = true`) are ONLY visible to their explicit `team_member` rows
 * (or instance admins) — NOT even to non-member workspace admins.
 */
export async function canAccessTeam(
  userId: string,
  teamId: string,
  isInstanceAdmin = false,
): Promise<boolean> {
  const [team] = await db
    .select({
      id: schema.teamTable.id,
      workspaceId: schema.teamTable.workspaceId,
      isPrivate: schema.teamTable.isPrivate,
    })
    .from(schema.teamTable)
    .where(eq(schema.teamTable.id, teamId))
    .limit(1);
  if (!team) return false;
  if (isInstanceAdmin) return true;
  if (!team.isPrivate) return true;

  const [membership] = await db
    .select({ id: schema.teamMemberTable.id })
    .from(schema.teamMemberTable)
    .where(
      and(
        eq(schema.teamMemberTable.teamId, teamId),
        eq(schema.teamMemberTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

/**
 * Lists teams in `workspaceId` visible to `userId`, hiding private teams the caller is not
 * explicitly a member of (#306).
 */
export async function listVisibleTeams(
  userId: string,
  workspaceId: string,
  isInstanceAdmin = false,
) {
  if (isInstanceAdmin) {
    return db
      .select()
      .from(schema.teamTable)
      .where(eq(schema.teamTable.workspaceId, workspaceId));
  }

  const memberships = await db
    .select({ teamId: schema.teamMemberTable.teamId })
    .from(schema.teamMemberTable)
    .where(eq(schema.teamMemberTable.userId, userId));
  const myTeamIds = memberships.map((m) => m.teamId);

  return db
    .select()
    .from(schema.teamTable)
    .where(
      and(
        eq(schema.teamTable.workspaceId, workspaceId),
        myTeamIds.length > 0
          ? or(
              eq(schema.teamTable.isPrivate, false),
              inArray(schema.teamTable.id, myTeamIds),
            )
          : eq(schema.teamTable.isPrivate, false),
      ),
    );
}
