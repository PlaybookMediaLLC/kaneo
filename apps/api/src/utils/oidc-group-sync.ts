import { and, desc, eq } from "drizzle-orm";
import db from "../database";
import {
  oidcGroupRoleMappingTable,
  workspaceUserTable,
} from "../database/schema";
import { isOwnerRole } from "../project-access/is-owner-role";
import { revokeWorkspaceRoleChange } from "../ws";

/** Extracts normalized OIDC group names from a standard `groups` / `roles` IdP claim. */
export function extractOidcGroups(
  profile: Record<string, unknown>,
  claimName = "groups",
): string[] {
  const raw = profile[claimName];
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }
  if (typeof raw === "string") {
    return [
      ...new Set(
        raw
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }
  return [];
}

/**
 * Pure role resolution helper for OIDC group -> Kaneo workspace role mapping (#306).
 * Picks the highest-priority matching group mapping, or demotes to `fallbackRole` ("member")
 * when the user no longer belongs to any mapped group.
 */
export function resolveOidcMappedRole(
  userGroups: readonly string[],
  mappings: ReadonlyArray<{
    groupName: string;
    role: string;
    priority: number;
  }>,
  fallbackRole = "member",
): string {
  const groupSet = new Set(userGroups.map((g) => g.toLowerCase()));
  const matched = mappings
    .filter((m) => groupSet.has(m.groupName.toLowerCase()))
    .sort((a, b) => b.priority - a.priority);
  return matched[0]?.role ?? fallbackRole;
}

/**
 * Reconciles a user's workspace roles against configured `oidc_group_role_mapping` rules on OIDC
 * sign-in (#306). Supports both promotion and demotion while never demoting the sole workspace
 * owner. Publishes immediate WS revocation whenever a role changes.
 */
export async function reconcileOidcGroupRoles(
  userId: string,
  userGroups: readonly string[],
): Promise<
  Array<{ workspaceId: string; previousRole: string; nextRole: string }>
> {
  const memberships = await db
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));

  const changes: Array<{
    workspaceId: string;
    previousRole: string;
    nextRole: string;
  }> = [];

  for (const membership of memberships) {
    const mappings = await db
      .select({
        groupName: oidcGroupRoleMappingTable.groupName,
        role: oidcGroupRoleMappingTable.role,
        priority: oidcGroupRoleMappingTable.priority,
      })
      .from(oidcGroupRoleMappingTable)
      .where(eq(oidcGroupRoleMappingTable.workspaceId, membership.workspaceId))
      .orderBy(desc(oidcGroupRoleMappingTable.priority));

    if (mappings.length === 0) continue;

    const nextRole = resolveOidcMappedRole(userGroups, mappings, "member");
    if (nextRole === membership.role) continue;

    // Never demote the sole owner of a workspace.
    if (isOwnerRole(membership.role) && !isOwnerRole(nextRole)) {
      const members = await db
        .select({
          userId: workspaceUserTable.userId,
          role: workspaceUserTable.role,
        })
        .from(workspaceUserTable)
        .where(eq(workspaceUserTable.workspaceId, membership.workspaceId));
      const owners = members.filter((m) => isOwnerRole(m.role));
      if (owners.length <= 1) continue;
    }

    await db
      .update(workspaceUserTable)
      .set({ role: nextRole })
      .where(
        and(
          eq(workspaceUserTable.workspaceId, membership.workspaceId),
          eq(workspaceUserTable.userId, userId),
        ),
      );

    await revokeWorkspaceRoleChange(userId, membership.workspaceId);
    changes.push({
      workspaceId: membership.workspaceId,
      previousRole: membership.role,
      nextRole,
    });
  }

  return changes;
}
