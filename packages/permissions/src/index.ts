import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
  // view_revenue: customer revenue (company MRR and the revenue of a request's companies).
  // comment_internal: internal notes and @mentions without customer-facing reply access (#328).
  quills: [
    "read",
    "create",
    "update",
    "delete",
    "manage_settings",
    "view_revenue",
    "comment_internal",
  ],
} as const;

export const ac = createAccessControl(statement);

export const viewer = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  task: ["read"],
  label: ["read"],
  workspace: ["read"],
  quills: ["read"],
});

export const collaborator = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  task: ["read"],
  label: ["read"],
  workspace: ["read"],
  quills: ["read", "comment_internal"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  project: ["create", "read"],
  task: ["create", "read", "update"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read"],
  quills: ["read", "create", "update", "view_revenue", "comment_internal"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "manage_settings"],
  quills: [
    "read",
    "create",
    "update",
    "delete",
    "manage_settings",
    "view_revenue",
    "comment_internal",
  ],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
  quills: [
    "read",
    "create",
    "update",
    "delete",
    "manage_settings",
    "view_revenue",
    "comment_internal",
  ],
});

export const builtInRoles = {
  viewer,
  collaborator,
  member,
  admin,
  owner,
} as const;

export type BuiltInRoleName = keyof typeof builtInRoles;

/** Roles that never count as paid billing seats on any plan (#328). */
export const FREE_SEAT_ROLES = ["viewer", "collaborator"] as const;
export type FreeSeatRoleName = (typeof FREE_SEAT_ROLES)[number];

export function isFreeSeatRole(role: string): boolean {
  return (FREE_SEAT_ROLES as readonly string[]).includes(
    role.trim().toLowerCase(),
  );
}

// Default-role names that the API seeds per workspace. These ARE editable in
// the UI (their permissions live as rows in `workspace_role`), but their names
// are reserved and the rows are auto-created on workspace creation /
// backfilled at boot. `owner` is intentionally NOT in this list because it
// stays a true static role on the better-auth side.
export const DEFAULT_ROLE_NAMES = [
  "viewer",
  "collaborator",
  "member",
  "admin",
] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

function toMutablePayload(
  statements: Record<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(statements)) {
    out[resource] = [...actions];
  }
  return out;
}

// Plain JSON-serializable permission payloads for the seeded default roles.
// Mirrors each role's `.statements` (including better-auth's organization/
// member/team/invitation/ac defaults) so a workspace_role row that uses one
// of these has parity with the prior static definition.
export const defaultRolePayloads: Record<
  DefaultRoleName,
  Record<string, string[]>
> = {
  viewer: toMutablePayload(viewer.statements),
  collaborator: toMutablePayload(collaborator.statements),
  member: toMutablePayload(member.statements),
  admin: toMutablePayload(admin.statements),
};

export {
  WORKSPACE_CAPABILITY_NAMES,
  type WorkspaceCapability,
  workspaceCapabilities,
} from "./capabilities.js";

export {
  BUILT_IN_INSTANCE_ROLES,
  type BuiltInInstanceRole,
  CUSTOM_ROLE_PERMISSIONS,
  type CustomRolePermission,
  INSTANCE_PERMISSIONS,
  INSTANCE_ROLE_NAME_PATTERN,
  type InstancePermission,
  isBuiltInInstanceRole,
  isCustomRolePermission,
  isInstancePermission,
  parseInstanceRoles,
} from "./instance.js";
