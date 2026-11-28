import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../database/schema";
import { runQuillsMigrations } from "../database/quills/migrate";
import { withQuillsSystemWorkspace } from "../database/quills/client";
import { seedSystemData } from "../database/quills/seed-system";
import { settings } from "../database/quills/schema/auth";
import {
  permissions,
  principalRoleAssignments,
  roles,
} from "../database/quills/schema/rbac";
import { openHelpCenter } from "../quills/content/public/help-center/visibility";
import {
  getSmtpProviderConfigView,
  saveSmtpProviderConfig,
  sealProviderPayload,
  unsealProviderPayload,
} from "../admin/providers/provider-config";
import {
  extractOidcGroups,
  reconcileOidcGroupRoles,
  resolveOidcMappedRole,
} from "./oidc-group-sync";
import { canAccessTeam, listVisibleTeams } from "./team-visibility";
import * as wsModule from "../ws";

let pool: Pool;
vi.mock("../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;

describe("OIDC group role resolution & encrypted provider sealing (unit)", () => {
  it("extracts OIDC groups from array or delimited string claims", () => {
    expect(extractOidcGroups({ groups: ["eng", "admins", "eng"] })).toEqual([
      "eng",
      "admins",
    ]);
    expect(extractOidcGroups({ groups: "eng, support" })).toEqual([
      "eng",
      "support",
    ]);
    expect(extractOidcGroups({})).toEqual([]);
  });

  it("picks highest-priority matching group and demotes when groups are removed", () => {
    const mappings = [
      { groupName: "support", role: "member", priority: 10 },
      { groupName: "platform-admins", role: "admin", priority: 100 },
    ];
    expect(
      resolveOidcMappedRole(["support", "platform-admins"], mappings),
    ).toBe("admin");
    expect(resolveOidcMappedRole(["support"], mappings)).toBe("member");
    expect(resolveOidcMappedRole([], mappings, "member")).toBe("member");
  });

  it("seals and unseals provider secrets with AES-256-GCM", () => {
    const sealed = sealProviderPayload({
      host: "smtp.example.com",
      password: "super-secret-password",
    });
    expect(sealed).not.toContain("super-secret-password");
    const unsealed = unsealProviderPayload<{ host: string; password: string }>(
      sealed,
    );
    expect(unsealed).toEqual({
      host: "smtp.example.com",
      password: "super-secret-password",
    });
  });
});

describe.skipIf(!url)(
  "Unified identity & permission model (#306, real PostgreSQL)",
  () => {
    const wsId = `ws-id-${Date.now()}`;
    const ownerId = `u-owner-${Date.now()}`;
    const adminId = `u-admin-${Date.now()}`;
    const memberId = `u-member-${Date.now()}`;
    const privTeamId = `team-priv-${Date.now()}`;
    const pubTeamId = `team-pub-${Date.now()}`;

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      const rootDb = drizzle(pool, { schema: kaneo });
      await migrate(rootDb, {
        migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
      });
      await runQuillsMigrations(
        url!,
        new URL("../../drizzle/quills", import.meta.url).pathname,
      );
      await rootDb.insert(kaneo.workspaceTable).values({
        id: wsId,
        name: "Unified RBAC WS",
        slug: wsId,
        createdAt: new Date(),
      });
      await rootDb.insert(kaneo.userTable).values([
        {
          id: ownerId,
          name: "Owner",
          email: `${ownerId}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: adminId,
          name: "Workspace Admin",
          email: `${adminId}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: memberId,
          name: "Team Member",
          email: `${memberId}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      await rootDb.insert(kaneo.workspaceUserTable).values([
        {
          id: `wm-${ownerId}`,
          workspaceId: wsId,
          userId: ownerId,
          role: "owner",
          joinedAt: new Date(),
        },
        {
          id: `wm-${adminId}`,
          workspaceId: wsId,
          userId: adminId,
          role: "admin",
          joinedAt: new Date(),
        },
        {
          id: `wm-${memberId}`,
          workspaceId: wsId,
          userId: memberId,
          role: "member",
          joinedAt: new Date(),
        },
      ]);
    }, 120_000);

    afterAll(async () => {
      if (pool) {
        await pool.query("DELETE FROM public.workspace WHERE id = $1", [wsId]);
        await pool.query("DELETE FROM public.user WHERE id IN ($1, $2, $3)", [
          ownerId,
          adminId,
          memberId,
        ]);
        await pool.query(
          "DELETE FROM public.instance_provider_config WHERE provider_key = 'smtp'",
        );
        await pool.end();
      }
    });

    it("retires legacy Quills RBAC seeding and enforces portal access on widget help center", async () => {
      await withQuillsSystemWorkspace(wsId, async (tx) => {
        await seedSystemData(tx);
        expect(await tx.select().from(roles)).toEqual([]);
        expect(await tx.select().from(permissions)).toEqual([]);
        expect(await tx.select().from(principalRoleAssignments)).toEqual([]);

        // Enable help center + widget, but set portal access to private (members_only)
        const featureFlagsJson = JSON.stringify({ helpCenter: true });
        const widgetConfigJson = JSON.stringify({ enabled: true });
        const portalConfigJson = JSON.stringify({
          enabled: true,
          access: { visibility: "private" },
        });
        await tx
          .insert(settings)
          .values({
            name: "Unified RBAC WS",
            slug: wsId,
            createdAt: new Date(),
            featureFlags: featureFlagsJson,
            widgetConfig: widgetConfigJson,
            portalConfig: portalConfigJson,
          })
          .onConflictDoUpdate({
            target: settings.workspaceId,
            set: {
              featureFlags: featureFlagsJson,
              widgetConfig: widgetConfigJson,
              portalConfig: portalConfigJson,
            },
          });

        // Unauthenticated widget caller MUST be denied on private help center (#306)
        await expect(
          openHelpCenter(
            tx,
            { principalId: null, customerId: null, account: null },
            "widget",
            undefined,
          ),
        ).rejects.toMatchObject({ status: 404 });
      });
    });

    it("enforces private team isolation even against non-member workspace admins", async () => {
      const rootDb = drizzle(pool, { schema: kaneo });
      await rootDb.insert(kaneo.teamTable).values([
        {
          id: pubTeamId,
          name: "Public Engineering",
          isPrivate: false,
          workspaceId: wsId,
          createdAt: new Date(),
        },
        {
          id: privTeamId,
          name: "Executive Security",
          isPrivate: true,
          workspaceId: wsId,
          createdAt: new Date(),
        },
      ]);
      await rootDb.insert(kaneo.teamMemberTable).values({
        id: `tm-${memberId}`,
        teamId: privTeamId,
        userId: memberId,
        role: "lead",
        createdAt: new Date(),
      });

      // Non-member workspace admin CANNOT see or access the private team
      expect(await canAccessTeam(adminId, privTeamId, false)).toBe(false);
      const adminVisible = await listVisibleTeams(adminId, wsId, false);
      expect(adminVisible.map((t) => t.id)).toEqual([pubTeamId]);

      // Explicit team lead CAN see and access the private team
      expect(await canAccessTeam(memberId, privTeamId, false)).toBe(true);
      const memberVisible = await listVisibleTeams(memberId, wsId, false);
      expect(memberVisible.map((t) => t.id).sort()).toEqual(
        [privTeamId, pubTeamId].sort(),
      );
    });

    it("reconciles OIDC groups with promotion, demotion, sole-owner protection, and immediate WS revocation", async () => {
      const rootDb = drizzle(pool, { schema: kaneo });
      await rootDb.insert(kaneo.oidcGroupRoleMappingTable).values([
        {
          workspaceId: wsId,
          groupName: "kaneo-admins",
          role: "admin",
          priority: 100,
        },
      ]);

      const revokeSpy = vi.spyOn(wsModule, "revokeWorkspaceRoleChange");

      // Promote member -> admin via OIDC group
      const promoted = await reconcileOidcGroupRoles(memberId, [
        "kaneo-admins",
      ]);
      expect(promoted).toEqual([
        { workspaceId: wsId, previousRole: "member", nextRole: "admin" },
      ]);
      expect(revokeSpy).toHaveBeenCalledWith(memberId, wsId);

      // Demote admin -> member when group is removed
      const demoted = await reconcileOidcGroupRoles(memberId, []);
      expect(demoted).toEqual([
        { workspaceId: wsId, previousRole: "admin", nextRole: "member" },
      ]);

      // Sole owner is NEVER demoted even if their OIDC groups are empty
      const ownerChanges = await reconcileOidcGroupRoles(ownerId, []);
      expect(ownerChanges).toEqual([]);
      const [ownerRow] = await rootDb
        .select({ role: kaneo.workspaceUserTable.role })
        .from(kaneo.workspaceUserTable)
        .where(eq(kaneo.workspaceUserTable.userId, ownerId));
      expect(ownerRow?.role).toBe("owner");
    });

    it("persists encrypted SMTP config and redacts password on read", async () => {
      const prevHost = process.env.SMTP_HOST;
      delete process.env.SMTP_HOST;
      try {
        const saved = await saveSmtpProviderConfig(
          {
            host: "mail.acme.internal",
            port: 587,
            secure: false,
            username: "mailer",
            password: "top-secret-smtp-password",
            from: "noreply@acme.internal",
          },
          ownerId,
        );
        expect(saved.configured).toBe(true);
        expect(saved.hasPassword).toBe(true);
        expect(JSON.stringify(saved)).not.toContain("top-secret-smtp-password");

        const readBack = await getSmtpProviderConfigView();
        expect(readBack.host).toBe("mail.acme.internal");
        expect(readBack.hasPassword).toBe(true);
      } finally {
        if (prevHost !== undefined) process.env.SMTP_HOST = prevHost;
      }
    });
  },
);
