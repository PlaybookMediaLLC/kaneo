import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import {
  channelAccounts,
  emailSendingDomains,
} from "../../database/quills/schema/channel-accounts";
import { customDomains } from "../../database/quills/schema/custom-domains";
import { events } from "../../database/quills/schema/events";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { teams } from "../../database/quills/schema/teams";
import * as kaneo from "../../database/schema";
import { contractApp } from "../framework/contract";
import { startFeature } from "../feedback/harness.fixture";
import quillsRouter from "../index";

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

const url = process.env.QUILLS_TEST_DATABASE_URL;
let w: Awaited<ReturnType<typeof startFeature>>;
const app = contractApp(quillsRouter);
const domain = (label: string) =>
  `${label}-${w.a.replaceAll("_", "-")}.example.com`;
const inB = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/quills/${w.b}${path}`, {
    method,
    headers: {
      "x-test-user": w.users.outsider,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const stored = async (value: string) =>
  (
    await pool.query(
      "SELECT workspace_id, kind FROM quills.custom_domains WHERE domain=$1",
      [value],
    )
  ).rows;

describe.skipIf(!url)("Quills operations", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    w = await startFeature(pool, url!, "operations");
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await w?.stop();
  });

  it("keeps one domain in one workspace and releases it on removal", async () => {
    const name = domain("help");
    const set = await w.request(
      w.users.owner,
      "PUT",
      "/operations/domains/portal",
      {
        domain: ` ${name.toUpperCase()}. `,
      },
    );
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      changed: true,
      domain: {
        kind: "portal",
        domain: name,
        active: false,
        record: { type: "TXT", name: `_kaneo-verification.${name}` },
      },
    });

    // Another workspace, through the API and straight through quills_runtime.
    expect(
      await inB("PUT", "/operations/domains/portal", { domain: name }),
    ).toMatchObject({
      status: 409,
    });
    await expect(
      w.scoped(w.b, w.users.outsider, (db) =>
        db.insert(customDomains).values({
          kind: "help_center",
          domain: name,
          verificationValue: "x",
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    // The other kind in the same workspace.
    expect(
      (
        await w.request(
          w.users.owner,
          "PUT",
          "/operations/domains/help-center",
          {
            domain: name,
          },
        )
      ).status,
    ).toBe(409);
    expect(await stored(name)).toEqual([{ workspace_id: w.a, kind: "portal" }]);
    // B sees only its own rows.
    expect((await inB("GET", "/operations/domains")).body.domains).toEqual([]);

    expect(
      (await w.request(w.users.owner, "DELETE", "/operations/domains/portal"))
        .body,
    ).toEqual({ removed: true, domain: name });
    expect(
      (await w.request(w.users.owner, "DELETE", "/operations/domains/portal"))
        .body,
    ).toEqual({ removed: false, domain: null });
    expect(
      (await inB("PUT", "/operations/domains/portal", { domain: name })).status,
    ).toBe(200);
    expect(await stored(name)).toEqual([{ workspace_id: w.b, kind: "portal" }]);
    await inB("DELETE", "/operations/domains/portal");
  });

  it("lets only one of two concurrent claims win", async () => {
    const name = domain("race");
    const results = await Promise.all([
      w.request(w.users.owner, "PUT", "/operations/domains/help-center", {
        domain: name,
      }),
      inB("PUT", "/operations/domains/help-center", { domain: name }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stored(name)).toHaveLength(1);
    await w.request(w.users.owner, "DELETE", "/operations/domains/help-center");
    await inB("DELETE", "/operations/domains/help-center");
  });

  it("keeps a verification when the same domain is sent again and resets it for a new one", async () => {
    const name = domain("same");
    const first = await w.request(
      w.users.owner,
      "PUT",
      "/operations/domains/portal",
      {
        domain: name,
      },
    );
    await pool.query(
      "UPDATE quills.custom_domains SET verified_at=now() WHERE workspace_id=$1 AND kind='portal'",
      [w.a],
    );
    const again = await w.request(
      w.users.owner,
      "PUT",
      "/operations/domains/portal",
      {
        domain: name,
      },
    );
    expect(again.body).toMatchObject({
      changed: false,
      domain: { active: true },
    });
    const moved = await w.request(
      w.users.owner,
      "PUT",
      "/operations/domains/portal",
      {
        domain: domain("other"),
      },
    );
    expect(moved.body).toMatchObject({
      changed: true,
      domain: { active: false },
    });
    expect(moved.body.domain.record.value).not.toBe(
      first.body.domain.record.value,
    );
    // The old domain is free again.
    expect(await stored(name)).toEqual([]);
    await w.request(w.users.owner, "DELETE", "/operations/domains/portal");
  });

  it("queues a check only for a stored domain", async () => {
    expect(
      (
        await w.request(
          w.users.owner,
          "POST",
          "/operations/domains/help-center/verify",
        )
      ).status,
    ).toBe(404);
    const name = domain("check");
    await w.request(w.users.owner, "PUT", "/operations/domains/help-center", {
      domain: name,
    });
    const verify = await w.request(
      w.users.owner,
      "POST",
      "/operations/domains/help-center/verify",
    );
    expect(verify.status).toBe(200);
    const [event] = await w.scoped(w.a, w.users.owner, (db) =>
      db
        .select({ payload: events.payload })
        .from(events)
        .where(
          and(
            eq(events.type, "custom_domain.verification_requested"),
            eq(events.entityId, name),
          ),
        ),
    );
    expect(event?.payload).toEqual({ kind: "help_center" });
    await w.request(w.users.owner, "DELETE", "/operations/domains/help-center");
  });

  it("returns Kaneo's upgrade error when the plan is not active, but always allows the reverse action", async () => {
    vi.stubEnv("KANEO_CLOUD", "true");
    vi.stubEnv("CREEM_API_KEY", "test");
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "test");
    await w.db.insert(kaneo.workspaceBillingTable).values({
      workspaceId: w.a,
      trialEndsAt: new Date(Date.now() - 86400000),
    });
    try {
      const name = domain("paid");
      await w.scoped(w.a, w.users.owner, (db) =>
        db
          .insert(customDomains)
          .values({ kind: "portal", domain: name, verificationValue: "x" }),
      );
      const put = await w.request(
        w.users.owner,
        "PUT",
        "/operations/domains/help-center",
        {
          domain: domain("paid-two"),
        },
      );
      expect(put.status).toBe(402);
      expect(
        (
          await w.request(
            w.users.owner,
            "POST",
            "/operations/domains/portal/verify",
          )
        ).status,
      ).toBe(402);
      expect(
        (await w.request(w.users.owner, "GET", "/operations/domains")).body
          .entitled,
      ).toBe(false);
      expect(
        (
          await w.request(w.users.owner, "PUT", "/operations/powered-by", {
            showPoweredBy: false,
          })
        ).status,
      ).toBe(402);
      expect(
        (
          await w.request(w.users.owner, "PUT", "/operations/powered-by", {
            showPoweredBy: true,
          })
        ).body,
      ).toEqual({ showPoweredBy: true });
      expect(
        (await w.request(w.users.owner, "DELETE", "/operations/domains/portal"))
          .body,
      ).toEqual({ removed: true, domain: name });
      expect(await stored(domain("paid-two"))).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await w.db
        .delete(kaneo.workspaceBillingTable)
        .where(eq(kaneo.workspaceBillingTable.workspaceId, w.a));
    }
  });

  it("counts usage only on boards the caller can see, without test customers", async () => {
    await w.scoped(w.a, w.users.owner, async (db, actor) => {
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true));
      const [open, hidden] = await db
        .insert(boards)
        .values([
          { name: "Open", slug: `${w.a}-open` },
          { name: "Hidden", slug: `${w.a}-hidden` },
        ])
        .returning({ id: boards.id });
      await db
        .insert(boardProjects)
        .values({ boardId: hidden!.id, projectId: w.projects.hidden });
      const [tester] = await db
        .insert(principal)
        .values({
          displayName: "Tester",
          createdAt: new Date(),
          testOwnerPrincipalId: actor.principalId,
        })
        .returning({ id: principal.id });
      const post = (
        boardId: typeof boards.$inferSelect.id,
        principalId = actor.principalId,
      ) => ({
        title: "Usage",
        content: "Usage",
        boardId,
        principalId,
        statusId: status!.id,
      });
      await db
        .insert(posts)
        .values([post(open!.id), post(hidden!.id), post(open!.id, tester!.id)]);
      const log = { pipelineStep: "test", model: "test", durationMs: 1 };
      await db.insert(aiUsageLog).values([
        { ...log, callType: "chat_completion", totalTokens: 100 },
        {
          ...log,
          callType: "chat_completion",
          totalTokens: 50,
          status: "error",
        },
        { ...log, callType: "embedding", totalTokens: 1000 },
        {
          ...log,
          callType: "chat_completion",
          totalTokens: 7,
          createdAt: new Date(Date.UTC(2000, 0, 1)),
        },
      ]);
    });
    expect(
      (await w.request(w.users.owner, "GET", "/operations/usage")).body,
    ).toEqual({
      aiTokensThisMonth: 100,
      postCount: 2,
      boardCount: 2,
    });
    expect(
      (await w.request(w.users.member, "GET", "/operations/usage")).body,
    ).toEqual({
      aiTokensThisMonth: 100,
      postCount: 1,
      boardCount: 1,
    });
    expect((await inB("GET", "/operations/usage")).body).toEqual({
      aiTokensThisMonth: 0,
      postCount: 0,
      boardCount: 0,
    });
  });

  it("records the longest accepted domain and refuses a longer or invalid one with 400", async () => {
    const label = "a".repeat(63);
    const longest = `${label}.${label}.${label}.${w.a.slice(-4).replaceAll("_", "-")}.com`;
    expect(longest).toHaveLength(200);
    const set = await w.request(
      w.users.owner,
      "PUT",
      "/operations/domains/help-center",
      { domain: longest },
    );
    expect(set.status).toBe(200);
    for (const bad of [`c${longest}`, "1.2.3.4"])
      expect(
        (
          await w.request(w.users.owner, "PUT", "/operations/domains/portal", {
            domain: bad,
          })
        ).status,
        bad,
      ).toBe(400);
    await w.request(w.users.owner, "DELETE", "/operations/domains/help-center");
  });

  it("lists only this workspace's sending domains, with the addresses that send from each", async () => {
    const seedSending = (workspaceId: string, userId: string, name: string) =>
      w.scoped(workspaceId, userId, async (db) => {
        const [team] = await db
          .insert(teams)
          .values({ name: `Mail ${name}` })
          .returning({ id: teams.id });
        const [sending] = await db
          .insert(emailSendingDomains)
          .values({ owningTeamId: team!.id, domain: name })
          .returning({ id: emailSendingDomains.id });
        const account = (address: string, extra = {}) => ({
          owningTeamId: team!.id,
          role: "sending" as const,
          address,
          ...extra,
        });
        await db.insert(channelAccounts).values([
          account(`help@${name}`, { sendingDomainId: sending!.id }),
          account(`HELP@${name}`, { sendingDomainId: sending!.id }),
          // No stored link: the domain after the @ decides.
          account(`Sales@${name.toUpperCase()}`),
          account(`gone@${name}`, { deletedAt: new Date() }),
          account(`inbound@${name}`, { role: "inbound" }),
        ]);
      });
    const mine = domain("mail");
    const theirs = domain("mail").replace("-a.", "-b.");
    await seedSending(w.a, w.users.owner, mine);
    await seedSending(w.b, w.users.outsider, theirs);
    expect(
      (await w.request(w.users.owner, "GET", "/operations/domains/sending"))
        .body,
    ).toEqual({
      domains: [
        {
          id: expect.any(String),
          domain: mine,
          status: "pending",
          verifiedAt: null,
          autoCheckUntil: null,
          localParts: ["help@", "sales@"],
        },
      ],
    });
    expect(
      (await inB("GET", "/operations/domains/sending")).body.domains.map(
        (d: { domain: string }) => d.domain,
      ),
    ).toEqual([theirs]);
  });

  it("queues a wipe only when the confirmation equals the workspace slug", async () => {
    const wipes = () =>
      w.scoped(w.a, w.users.owner, (db) =>
        db
          .select()
          .from(events)
          .where(eq(events.type, "workspace.wipe_requested")),
      );
    expect(
      (
        await w.request(w.users.owner, "POST", "/operations/wipe", {
          confirm: "wrong",
        })
      ).status,
    ).toBe(400);
    expect(await wipes()).toEqual([]);
    expect(
      (
        await w.request(w.users.owner, "POST", "/operations/wipe", {
          confirm: w.a,
        })
      ).body,
    ).toEqual({ queued: true });
    expect(await wipes()).toHaveLength(1);
  });
});
