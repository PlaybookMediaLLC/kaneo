import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createId } from "@kaneo/ids";
import { withQuillsWorkspace } from "../../database/quills/client";
import { auditLog } from "../../database/quills/schema/audit-log";
import { principal, settings } from "../../database/quills/schema/auth";
import { events } from "../../database/quills/schema/events";
import { importRuns } from "../../database/quills/schema/import-runs";
import { jobQueue } from "../../database/quills/schema/job-queue";
import * as kaneo from "../../database/schema";
import { RECEIPT_MAX_BYTES, recordQuillsChange } from "../events";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { loadEvent } from "../jobs/fanout";
import { signedWebhook } from "../jobs/handlers/webhook";
import { exportWorkspaceArchive } from "../transfer/archive";
import {
  importWorkspaceArchive,
  prepareArchive,
} from "../transfer/import-archive";
import { parseJson } from "./area";
import { brandingReceipt } from "./branding";
import { developerReceipt } from "./developer";
import { labsReceipt } from "./labs";
import { portalReceipt } from "./portal";
import { RECEIPT_LIMIT_BYTES } from "./receipt-fields";
import { widgetReceipt } from "./widget";

let pool: Pool;
vi.mock("../../database/index", () => ({
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
vi.mock("../../storage/s3", async (original) => ({
  ...(await original<typeof import("../../storage/s3")>()),
  verifyPrivateObjectExists: vi.fn(async () => {}),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter);
const member = `receipts_member_${Date.now().toString(36)}`;
const target = `receipts_target_${Date.now().toString(36)}`;

async function call(
  method: string,
  path: string,
  body?: unknown,
  as?: string,
  workspaceId = contractEnv().a,
) {
  const res = await app.request(`/quills/${workspaceId}${path}`, {
    method,
    headers: {
      "x-test-user": as ?? contractEnv().owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || "null") };
}
const undo = (receiptId: string, workspaceId?: string) =>
  call(
    "POST",
    `/settings/receipts/${receiptId}/undo`,
    undefined,
    undefined,
    workspaceId,
  );
const inA = <T>(
  work: Parameters<ReturnType<typeof contractEnv>["scoped"]>[1],
) => contractEnv().scoped(contractEnv().a, work) as Promise<T>;
/** The audit row of a receipt: its metadata, as stored. */
const receiptRow = (id: string) =>
  inA<{ metadata: unknown; occurredAt: Date; eventType: string }[]>((db) =>
    db
      .select({
        metadata: auditLog.metadata,
        occurredAt: auditLog.occurredAt,
        eventType: auditLog.eventType,
      })
      .from(auditLog)
      .where(eq(auditLog.id, id as never)),
  );

describe.skipIf(!url)("Quills settings receipts and undo", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    const env = contractEnv();
    await env.db.insert(kaneo.userTable).values({
      id: member,
      name: member,
      email: `${member}@example.test`,
    });
    await env.db.insert(kaneo.workspaceUserTable).values({
      workspaceId: env.a,
      userId: member,
      role: "member",
      joinedAt: new Date(),
    });
    await env.db.insert(kaneo.workspaceTable).values({
      id: target,
      name: target,
      slug: target,
      createdAt: new Date(),
    });
    await env.db.insert(kaneo.workspaceUserTable).values({
      workspaceId: target,
      userId: env.owner,
      role: "owner",
      joinedAt: new Date(),
    });
  }, 120000);
  afterAll(async () => {
    await pool.query("DELETE FROM public.workspace WHERE id = $1", [target]);
    await pool.query("DELETE FROM public.workspace_member WHERE user_id = $1", [
      member,
    ]);
    await pool.query('DELETE FROM public."user" WHERE id = $1', [member]);
    await stopContract();
  });

  it("refuses a receipt that came in with a workspace import", async () => {
    const env = contractEnv();
    const write = await call("PUT", "/settings/labs", { statusPage: true });
    expect(write.status).toBe(200);
    const receiptId = write.body.receiptId as string;
    // The first labs write stores no defaults, so its receipt holds only the flag it changed.
    const [first] = await receiptRow(receiptId);
    expect(first!.metadata).toEqual({
      receipt: {
        area: "labs",
        before: {},
        after: { "featureFlags.statusPage": true },
      },
    });
    const archive = await withQuillsWorkspace(
      { workspaceId: env.a, userId: env.owner },
      (tx) => exportWorkspaceArchive(tx, env.a),
    );
    // The import maps each teammate principal of A to a member of the target.
    const teammates = (
      await pool.query<{ id: string }>(
        "SELECT kaneo_user_id AS id FROM quills.principal WHERE workspace_id = $1 AND kaneo_user_id IS NOT NULL",
        [env.a],
      )
    ).rows.map((row) => row.id);
    const members = teammates.map((id) => ({ id, name: id, image: null }));
    for (const id of teammates.filter((id) => id !== env.owner))
      await env.db.insert(kaneo.workspaceUserTable).values({
        workspaceId: target,
        userId: id,
        role: "member",
        joinedAt: new Date(),
      });
    await withQuillsWorkspace(
      { workspaceId: target, userId: env.owner },
      (tx, actor) =>
        importWorkspaceArchive(
          tx,
          actor,
          prepareArchive(archive, {}, target, members),
          members,
          { name: target, slug: target },
        ),
      { exclusiveWorkspace: true },
    );
    // The receipt row is in the target now, under the same ID.
    const copied = await withQuillsWorkspace(
      { workspaceId: target, userId: env.owner },
      (tx) =>
        tx
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(eq(auditLog.id, receiptId as never)),
    );
    expect(copied).toHaveLength(1);
    const res = await undo(receiptId, target);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This change came with a workspace import.");

    // The same rule in the source workspace: an archive import after the write dates it out.
    const again = await call("PUT", "/settings/labs", { statusPage: false });
    await inA(async (db, actor) =>
      db.insert(importRuns).values({
        source: "api",
        fileName: "quills-workspace.json",
        initiatedByPrincipalId: actor.principalId,
        status: "completed",
      }),
    );
    expect((await undo(again.body.receiptId)).status).toBe(409);
    // A CSV import is not a workspace import.
    const later = await call("PUT", "/settings/labs", { statusPage: true });
    await inA(async (db, actor) =>
      db.insert(importRuns).values({
        source: "csv",
        fileName: "posts.csv",
        initiatedByPrincipalId: actor.principalId,
      }),
    );
    expect((await undo(later.body.receiptId)).status).toBe(200);
  });

  it("keeps non-allowlisted fields out of every area's receipt and undoes each area", async () => {
    const env = contractEnv();
    const secret = (await call("POST", "/settings/widget/secret")).body
      .secret as string;
    await call("POST", "/settings/widget/install-code");
    await inA((db) =>
      db.update(settings).set({
        logoKey: "logo-object-key",
        widgetHeroKey: "hero-object-key",
        portalConfig: sql`jsonb_set(coalesce(nullif(${settings.portalConfig}, ''), '{}')::jsonb, '{access}', '{"visibility":"public","allowedDomains":["access-domain.example"]}')::text`,
        developerConfig: JSON.stringify({ unlisted: "developer-unlisted" }),
      }),
    );
    const cases = [
      [
        "portal",
        portalReceipt,
        { allowAnonymous: true, nav: [{ id: "n1", type: "feedback" }] },
      ],
      [
        "branding",
        brandingReceipt,
        { customCss: ".a{color:red}", headerDisplayName: "Shop" },
      ],
      [
        "widget",
        widgetReceipt,
        {
          enabled: true,
          tabs: { help: true },
          home: { greeting: "Hi", gradient: { from: "#000000" } },
        },
      ],
      ["developer", developerReceipt, { mcpEnabled: false }],
      ["labs", labsReceipt, { helpCenter: true }],
    ] as const;
    for (const [area, allowlist, body] of cases) {
      const before = (await call("GET", `/settings/${area}`)).body;
      const write = await call("PUT", `/settings/${area}`, body);
      expect(write.status).toBe(200);
      expect(write.body.receiptId).toMatch(/^audit_/);
      expect(write.body).not.toHaveProperty("receipt");
      const [row] = await receiptRow(write.body.receiptId);
      const receipt = (row!.metadata as { receipt: Record<string, object> })
        .receipt;
      expect(receipt.area).toBe(area);
      for (const key of Object.keys({ ...receipt.before, ...receipt.after }))
        expect(allowlist).toContain(key);
      const text = JSON.stringify(row!.metadata);
      for (const hidden of [
        secret,
        "logo-object-key",
        "hero-object-key",
        "access-domain.example",
        "developer-unlisted",
        env.a,
      ])
        expect(text).not.toContain(hidden);
      const res = await undo(write.body.receiptId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: write.body.receiptId,
        area,
        undoneAt: expect.any(String),
      });
      expect((await call("GET", `/settings/${area}`)).body).toEqual(before);
    }
    // Undo restores only allowlisted fields: the keys that no route here writes stay.
    const [stored] = await inA<(typeof settings.$inferSelect)[]>((db) =>
      db.select().from(settings),
    );
    expect(stored!.logoKey).toBe("logo-object-key");
    expect(stored!.widgetSecret).toBe(secret);
    expect(stored!.portalConfig).toContain("access-domain.example");
    await inA((db) =>
      db.update(settings).set({ logoKey: null, widgetHeroKey: null }),
    );
  });

  it("refuses a second undo and a stale receipt, and never edits the receipt row", async () => {
    const first = await call("PUT", "/settings/portal", { enabled: true });
    const other = await call("PUT", "/settings/portal", { openSignup: true });
    const [receiptBefore] = await receiptRow(first.body.receiptId);
    // A later change of another field does not block the undo.
    expect((await undo(first.body.receiptId)).status).toBe(200);
    expect(await receiptRow(first.body.receiptId)).toEqual([receiptBefore]);
    const [undone] = await inA<{ metadata: unknown }[]>((db) =>
      db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventType, "settings.undone"),
            eq(auditLog.targetId, first.body.receiptId),
          ),
        ),
    );
    expect(undone!.metadata).toEqual({
      receipt: {
        area: "portal",
        before: { "portalConfig.enabled": true },
        after: (receiptBefore!.metadata as { receipt: { before: object } })
          .receipt.before,
      },
    });
    const twice = await undo(first.body.receiptId);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("This change was already undone.");

    // A later write of the same field makes the earlier receipt stale, even after its undo.
    const a = await call("PUT", "/settings/portal", { allowAnonymous: true });
    const b = await call("PUT", "/settings/portal", { allowAnonymous: false });
    expect((await undo(a.body.receiptId)).status).toBe(409);
    expect((await undo(b.body.receiptId)).status).toBe(200);
    expect((await undo(a.body.receiptId)).status).toBe(409);
    expect((await undo(other.body.receiptId)).status).toBe(200);

    // A change with no receipt (website branding writes the theme itself) also makes it stale.
    const theme = await call("PUT", "/settings/branding", {
      theme: { preset: "ocean" },
    });
    await inA((db) =>
      db
        .update(settings)
        .set({ brandingConfig: JSON.stringify({ preset: "forest" }) }),
    );
    const stale = await undo(theme.body.receiptId);
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe(
      "These settings changed since. Undo is unavailable.",
    );
  });

  it("orders receipts by the settings lock, not by when a transaction began", async () => {
    const env = contractEnv();
    /** A labs write with its receipt, as the update route does it, in a transaction that began earlier. */
    const early = (statusPage: boolean) => {
      let go!: () => void;
      const gate = new Promise<void>((resolve) => (go = resolve));
      let began!: () => void;
      const ready = new Promise<void>((resolve) => (began = resolve));
      const done = env.scoped(env.a, async (db, actor) => {
        began();
        await gate;
        const [row] = await db.select().from(settings).limit(1).for("update");
        const flags = parseJson(row!.featureFlags);
        await db
          .update(settings)
          .set({ featureFlags: JSON.stringify({ ...flags, statusPage }) })
          .where(eq(settings.id, row!.id));
        await recordQuillsChange(db, actor, {
          type: "settings.labs_updated",
          entityType: "settings",
          entityId: env.a,
          receiptId: createId("audit_log"),
          receipt: {
            area: "labs",
            before: { "featureFlags.statusPage": flags.statusPage === true },
            after: { "featureFlags.statusPage": statusPage },
          },
        });
      });
      return { ready, go, done };
    };
    await call("PUT", "/settings/labs", { statusPage: false });
    // B and C begin first; A takes the lock first, then B (off) and C (on).
    const b = early(false);
    const c = early(true);
    await Promise.all([b.ready, c.ready]);
    const a = await call("PUT", "/settings/labs", { statusPage: true });
    b.go();
    await b.done;
    c.go();
    await c.done;
    // C is the newest change and holds A's value, so only the order of the rows can refuse A.
    const res = await undo(a.body.receiptId);
    expect(res.status).toBe(409);
    expect((await call("GET", "/settings/labs")).body.statusPage).toBe(true);
  });

  it("answers 404 for an unknown ID or a row that is no receipt, and 403 without manage_settings", async () => {
    const env = contractEnv();
    expect((await undo(createId("audit_log"))).status).toBe(404);
    await call("POST", "/settings/widget/secret");
    const [rotation] = await inA<{ id: string }[]>((db) =>
      db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.eventType, "settings.widget_secret_rotated"))
        .limit(1),
    );
    expect((await undo(rotation!.id)).status).toBe(404);
    const write = await call("PUT", "/settings/labs", { supportInbox: true });
    const denied = await call(
      "POST",
      `/settings/receipts/${write.body.receiptId}/undo`,
      undefined,
      member,
    );
    expect(denied.status).toBe(403);
    // Unchanged values write no receipt.
    const same = await call("PUT", "/settings/labs", { supportInbox: true });
    expect(same.body.receiptId).toBeNull();

    // A receipt of another workspace is unknown here: 404, not the import 409.
    const foreign = await call(
      "PUT",
      "/settings/labs",
      { supportTickets: true },
      undefined,
      target,
    );
    expect(foreign.body.receiptId).toMatch(/^audit_/);
    const crossed = await undo(foreign.body.receiptId);
    expect(crossed.status).toBe(404);
    expect(crossed.body.message).toBe("Settings receipt not found");

    // A stored receipt with a key outside the area's allowlist restores nothing.
    const crafted = createId("audit_log");
    await inA((db, actor) =>
      recordQuillsChange(db, actor, {
        type: "settings.branding_updated",
        entityType: "settings",
        entityId: env.a,
        receiptId: crafted,
        receipt: {
          area: "branding",
          before: { logoKey: "planted-object-key" },
          after: { logoKey: null },
        },
      }),
    );
    const refused = await undo(crafted);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("This change cannot be undone.");
    const [row] = await inA<(typeof settings.$inferSelect)[]>((db) =>
      db.select().from(settings),
    );
    expect(row!.logoKey).toBeNull();
  });

  it("lets only one of two undos of the same receipt through", async () => {
    const write = await call("PUT", "/settings/labs", { supportTickets: true });
    const results = await Promise.all([
      undo(write.body.receiptId),
      undo(write.body.receiptId),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(
      await inA((db) =>
        db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.eventType, "settings.undone"),
              eq(auditLog.targetId, write.body.receiptId),
            ),
          ),
      ),
    ).toHaveLength(1);
  });

  it("saves a change that its audit row cannot hold, without a receipt", async () => {
    expect(RECEIPT_LIMIT_BYTES).toBe(RECEIPT_MAX_BYTES);
    // 51,200 characters fit the schema; two-byte characters before and after pass the byte limit.
    const first = await call("PUT", "/settings/branding", {
      customCss: "é".repeat(50 * 1024),
    });
    expect(first.status).toBe(200);
    const large = await call("PUT", "/settings/branding", {
      customCss: "ü".repeat(50 * 1024),
    });
    expect(large.status).toBe(200);
    expect(large.body.receiptId).toBeNull();
    // jsonb refuses a NUL character that a JSON text column holds.
    const nul = await call("PUT", "/settings/widget", {
      launcherGreeting: "a\u0000b",
    });
    expect(nul.status).toBe(200);
    expect(nul.body.receiptId).toBeNull();
    // A stored value of either kind does not block later writes of the key.
    for (const [area, body] of [
      ["branding", { customCss: "" }],
      ["widget", { launcherGreeting: "" }],
    ] as const) {
      const reset = await call("PUT", `/settings/${area}`, body);
      expect(reset.status).toBe(200);
    }
  });

  it("never puts a receipt in an event row, a job, a webhook body or a response", async () => {
    const marker = ".marker-before{color:red}";
    await call("PUT", "/settings/branding", { customCss: marker });
    const write = await call("PUT", "/settings/branding", {
      customCss: ".marker-after{}",
    });
    const undone = await undo(write.body.receiptId);
    expect(undone.status).toBe(200);
    const audits = await call("GET", "/audit-events?limit=100");
    expect(audits.status).toBe(200);
    for (const text of [write.text, undone.text, audits.text])
      expect(text).not.toContain("marker-before");
    const leaked = await inA<unknown[]>(async (db) => {
      const rows = await db
        .select({ eventId: events.eventId })
        .from(events)
        .where(
          sql`${events.type} in ('settings.branding_updated', 'settings.undone')`,
        );
      const bodies = [];
      for (const { eventId } of rows)
        bodies.push(
          signedWebhook((await loadEvent(db, eventId))!, "secret", "0").body,
        );
      return [
        bodies,
        await db.select({ payload: events.payload }).from(events),
        await db.select({ payload: jobQueue.payload }).from(jobQueue),
      ];
    });
    expect(JSON.stringify(leaked)).not.toMatch(
      /marker-before|marker-after|receipt/,
    );
    // The audit rows hold both.
    const [row] = await receiptRow(write.body.receiptId);
    expect(JSON.stringify(row!.metadata)).toContain("marker-before");
    expect(
      await inA((db) =>
        db
          .select({ id: principal.id })
          .from(principal)
          .where(eq(principal.kaneoUserId, contractEnv().owner)),
      ),
    ).toHaveLength(1);
  });
});
