import { describe, expect, it } from "vite-plus/test";
import {
  viewer,
  collaborator,
  member,
  admin,
  owner,
  isFreeSeatRole,
} from "./index";

describe("Quills workspace permissions", () => {
  it("keeps viewers read-only and requires an administrator for destructive or settings actions", () => {
    expect(viewer.authorize({ quills: ["read"] }).success).toBe(true);
    expect(viewer.authorize({ quills: ["create"] }).success).toBe(false);
    expect(viewer.authorize({ quills: ["comment_internal"] }).success).toBe(
      false,
    );
    expect(member.authorize({ quills: ["create", "update"] }).success).toBe(
      true,
    );
    expect(member.authorize({ quills: ["delete"] }).success).toBe(false);
    expect(member.authorize({ quills: ["manage_settings"] }).success).toBe(
      false,
    );
    for (const role of [admin, owner])
      expect(
        role.authorize({ quills: ["delete", "manage_settings"] }).success,
      ).toBe(true);
  });

  it("lets collaborators read and write internal notes only, never reply to customers", () => {
    expect(
      collaborator.authorize({ quills: ["read", "comment_internal"] }).success,
    ).toBe(true);
    expect(collaborator.authorize({ quills: ["create"] }).success).toBe(false);
    expect(collaborator.authorize({ quills: ["update"] }).success).toBe(false);
    expect(collaborator.authorize({ quills: ["delete"] }).success).toBe(false);
    expect(
      collaborator.authorize({ quills: ["manage_settings"] }).success,
    ).toBe(false);
    expect(isFreeSeatRole("collaborator")).toBe(true);
    expect(isFreeSeatRole("viewer")).toBe(true);
    expect(isFreeSeatRole("member")).toBe(false);
    expect(isFreeSeatRole("admin")).toBe(false);
    expect(isFreeSeatRole("owner")).toBe(false);
  });

  it("shows customer revenue to members, admins and owners, not viewers or collaborators", () => {
    expect(viewer.authorize({ quills: ["view_revenue"] }).success).toBe(false);
    expect(collaborator.authorize({ quills: ["view_revenue"] }).success).toBe(
      false,
    );
    for (const role of [member, admin, owner])
      expect(role.authorize({ quills: ["view_revenue"] }).success).toBe(true);
  });
});
