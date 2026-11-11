import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { openPublic } from "../content/public/seed.fixture";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { settings, user as customer } from "../../database/quills/schema/auth";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import {
  postSubscriptions,
  unsubscribeTokens,
} from "../../database/quills/schema/notifications";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { postVotes } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { statusComponents } from "../../database/quills/schema/status";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import { hashToken } from "../framework/audience";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { subscribers } from "../jobs/fanout";
import { drainQuillsWorkspace } from "../jobs/worker";
import { collectStorageKeys } from "../transfer/archive";
import { enableWidget, signIdentity } from "../widget/seed.fixture";
import {
  accountEmail,
  customerPost,
  enablePortal,
  verifyEmail,
} from "./customer-seed.fixture";
import { mintUnsubscribeToken, unsubscribeUrl } from "./unsubscribe-token";

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
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
vi.mock("../../ws", () => ({ broadcastToUserAndWait: vi.fn(async () => {}) }));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

/** A request as `user`: under /quills for a teammate route, /quills-public otherwise. */
async function call(
  method: string,
  path: string,
  options: {
    user?: string;
    body?: unknown;
    form?: string;
    teammate?: boolean;
    workspace?: string;
  } = {},
) {
  const env = contractEnv();
  const base = options.teammate ? "/quills" : "/quills-public";
  const res = await app.request(
    `${base}/${options.workspace ?? env.a}${path}`,
    {
      method,
      headers: {
        "x-test-user": options.user ?? "",
        "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
        ...(options.body !== undefined && {
          "content-type": "application/json",
        }),
        ...(options.form !== undefined && {
          "content-type": "application/x-www-form-urlencoded",
        }),
      },
      body:
        options.form ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}
const setPortal = (config: object) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.update(settings).set({ portalConfig: JSON.stringify(config) }),
  );

describe.skipIf(!url)("Quills portal invites and customer routes", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
    for (const key of [
      "EMAIL_SES_ACCESS_KEY_ID",
      "EMAIL_SES_SECRET_ACCESS_KEY",
      "EMAIL_RESEND_API_KEY",
      "RESEND_API_KEY",
      "EMAIL_SMTP_HOST",
    ])
      vi.stubEnv(key, "");
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopContract();
  });

  it("invites an address, mails it after commit and grants the private portal on accept", async () => {
    const env = contractEnv();
    const email = accountEmail(env.customerA);
    const invite = async (field: "status" | "token_hashes" | "raw") =>
      (
        await pool.query(
          `SELECT status, token_hashes, row_to_json(i)::text AS raw FROM quills.portal_invites i WHERE workspace_id=$1 AND email=$2 ORDER BY created_at DESC LIMIT 1`,
          [env.a, email],
        )
      ).rows[0]?.[field];

    const sent = await call("POST", "/portal/invites", {
      user: env.owner,
      teammate: true,
      body: { email: email.toUpperCase(), message: "Hello" },
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ email, status: "pending" });
    expect(JSON.stringify(sent.body)).not.toMatch(/hash|token/i);
    expect(
      (
        await call("POST", "/portal/invites", {
          user: env.owner,
          teammate: true,
          body: { email },
        })
      ).status,
    ).toBe(409);

    // The worker sends the mail; the job carries only the event, never the address or a token.
    const jobs = await pool.query(
      "SELECT payload::text FROM quills.job_queue WHERE workspace_id=$1 AND queue='quills.event'",
      [env.a],
    );
    expect(jobs.rows.map((row) => row.payload).join()).not.toContain(email);
    await drainQuillsWorkspace(env.a, async () => {});
    await drainQuillsWorkspace(env.a, async () => {});
    const mail = await pool.query(
      "SELECT address, email_type, status FROM quills.email_log WHERE workspace_id=$1 AND email_type='PortalInviteEmail'",
      [env.a],
    );
    expect(mail.rows).toEqual([
      { address: email, email_type: "PortalInviteEmail", status: "skipped" },
    ]);
    expect(await invite("token_hashes")).toHaveLength(1);

    // A copied link adds a token; only its hash is stored.
    const link = await call("POST", `/portal/invites/${sent.body.id}/link`, {
      user: env.owner,
      teammate: true,
    });
    expect(link.status).toBe(200);
    const token = new URL(link.body.inviteUrl).hash.replace("#token=", "");
    expect(token.length).toBeGreaterThan(40);
    expect(await invite("token_hashes")).toContain(hashToken(token));
    expect(await invite("raw")).not.toContain(token);

    await setPortal({ enabled: true, access: { visibility: "private" } });
    const access = () => call("GET", "/portal/access", { user: env.customerA });
    expect((await access()).body).toEqual({
      granted: false,
      reason: "unauthorized",
    });
    const accept = (user: string, value = token) =>
      call("POST", `/portal/invites/${sent.body.id}/accept`, {
        user,
        body: { token: value },
      });
    const profiles = () =>
      pool.query(
        "SELECT kaneo_user_id FROM quills.customer_identity WHERE workspace_id=$1 AND kaneo_user_id = ANY($2)",
        [env.a, [env.customerA, env.customerB]],
      );
    // Another account, a wrong token and an unverified address change nothing.
    expect((await accept(env.customerB)).status).toBe(403);
    expect((await accept(env.customerA, `${token}x`)).status).toBe(404);
    expect((await accept(env.customerA)).status).toBe(403);
    expect((await profiles()).rows).toEqual([]);
    expect(await invite("status")).toBe("pending");

    await verifyEmail(env, env.customerA);
    const members = await pool.query(
      "SELECT count(*)::int AS n FROM public.workspace_member WHERE workspace_id=$1",
      [env.a],
    );
    expect((await accept(env.customerA)).body).toEqual({
      accepted: true,
      alreadyAccepted: false,
    });
    expect(await invite("status")).toBe("accepted");
    expect(await invite("token_hashes")).toEqual([]);
    expect((await profiles()).rows).toEqual([{ kaneo_user_id: env.customerA }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM public.workspace_member WHERE workspace_id=$1",
          [env.a],
        )
      ).rows,
    ).toEqual(members.rows);
    expect((await access()).body).toEqual({ granted: true, reason: "invite" });
    expect((await accept(env.customerA)).body).toEqual({
      accepted: true,
      alreadyAccepted: true,
    });
    expect(
      (await call("GET", "/portal/access", { user: env.customerB })).body,
    ).toMatchObject({ granted: false });

    // While the portal is off, accepting is not found.
    await setPortal({ enabled: false });
    expect((await accept(env.customerA)).status).toBe(404);
  });

  it("keeps one pending invite per address under concurrent sends, inside the workspace", async () => {
    const env = contractEnv();
    const email = `${env.id("race")}@example.test`;
    const send = () =>
      call("POST", "/portal/invites", {
        user: env.owner,
        teammate: true,
        body: { email },
      });
    const statuses = (await Promise.all([send(), send(), send()]))
      .map((res) => res.status)
      .sort();
    expect(statuses).toEqual([200, 409, 409]);
    // The runtime role cannot write an invite into another workspace.
    await expect(
      env.scoped(env.a, (db) =>
        db.insert(portalInvites).values({
          workspaceId: env.b,
          email,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it("lets only a let-in caller use a private portal, and an invite opens only its own workspace", async () => {
    const env = contractEnv();
    // Customer A accepted an invite in A in the first test; customer B was never invited.
    const privatePortal = JSON.stringify({
      enabled: true,
      access: { visibility: "private" },
    });
    for (const workspaceId of [env.a, env.b])
      await env.scoped(workspaceId, (db) =>
        db.update(settings).set({ portalConfig: privatePortal }),
      );
    const subscribe = (user: string, workspace = env.a) =>
      call("PUT", "/changelog/subscription", { user, workspace });
    const rows = async (workspaceId: string) =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.changelog_subscriptions WHERE workspace_id=$1",
          [workspaceId],
        )
      ).rows[0].n;
    const before = { a: await rows(env.a), b: await rows(env.b) };
    expect((await subscribe(env.customerB)).status).toBe(403);
    expect((await call("GET", "/changelog/subscription")).status).toBe(403);
    expect((await subscribe(env.customerA, env.b)).status).toBe(403);
    expect(await rows(env.a)).toBe(before.a);
    expect(await rows(env.b)).toBe(before.b);
    expect((await subscribe(env.customerA)).status).toBe(200);
    expect(await rows(env.a)).toBe(before.a + 1);
    await setPortal({ enabled: true });
  });

  it("kills every link of a canceled invite", async () => {
    const env = contractEnv();
    await enablePortal(env, env.a);
    const email = `${env.id("cancel")}@example.test`;
    const sent = await call("POST", "/portal/invites", {
      user: env.owner,
      teammate: true,
      body: { email },
    });
    const link = await call("POST", `/portal/invites/${sent.body.id}/link`, {
      user: env.owner,
      teammate: true,
    });
    const canceled = await call("DELETE", `/portal/invites/${sent.body.id}`, {
      user: env.owner,
      teammate: true,
    });
    expect(canceled.body.status).toBe("canceled");
    const token = new URL(link.body.inviteUrl).hash.replace("#token=", "");
    expect(
      (
        await call("POST", `/portal/invites/${sent.body.id}/link`, {
          user: env.owner,
          teammate: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("POST", `/portal/invites/${sent.body.id}/accept`, {
          user: env.customerA,
          body: { token },
        })
      ).status,
    ).toBe(404);
    // The canceled invite frees the address for a new one.
    expect(
      (
        await call("POST", "/portal/invites", {
          user: env.owner,
          teammate: true,
          body: { email },
        })
      ).status,
    ).toBe(200);
  });

  it("previews an unsubscribe link without spending it, then spends it once", async () => {
    const env = contractEnv();
    const seed = (workspaceId: string) =>
      customerPost(env, workspaceId).then(({ postId }) =>
        env.scoped(workspaceId, async (db, actor) => {
          const principalId = actor.principalId as PrincipalId;
          await db.insert(postSubscriptions).values({
            postId: postId as PostId,
            principalId,
            reason: "manual",
          });
          return {
            postId,
            token: await mintUnsubscribeToken(
              db,
              principalId,
              "unsubscribe_post",
              postId as PostId,
            ),
          };
        }),
      );
    const a = await seed(env.a);
    const b = await seed(env.b);
    const subscribed = async (workspaceId: string, postId: string) =>
      (
        await env.scoped(workspaceId, (db) =>
          db
            .select({ id: postSubscriptions.id })
            .from(postSubscriptions)
            .where(eq(postSubscriptions.postId, postId as PostId)),
        )
      ).length;
    const stored = await pool.query(
      "SELECT token FROM quills.unsubscribe_tokens WHERE workspace_id=$1",
      [env.a],
    );
    expect(stored.rows.map((row) => row.token)).toContain(hashToken(a.token));
    expect(stored.rows.map((row) => row.token)).not.toContain(a.token);

    const preview = await call("GET", `/unsubscribe?token=${a.token}`);
    expect(preview.body).toMatchObject({
      valid: true,
      action: "unsubscribe_post",
    });
    expect(await subscribed(env.a, a.postId)).toBe(1);

    // B's link on A's path finds nothing and changes nothing.
    const crossed = await call("POST", `/unsubscribe?token=${b.token}`, {
      form: "List-Unsubscribe=One-Click",
    });
    expect(crossed.body).toMatchObject({ processed: false });
    expect(await subscribed(env.b, b.postId)).toBe(1);

    const oneClick = await call("POST", `/unsubscribe?token=${a.token}`, {
      form: "List-Unsubscribe=One-Click",
    });
    expect(oneClick.status).toBe(200);
    expect(oneClick.body).toMatchObject({ processed: true });
    expect(await subscribed(env.a, a.postId)).toBe(0);
    const again = await call("POST", "/unsubscribe/confirm", {
      body: { token: a.token },
    });
    expect(again.body).toMatchObject({ processed: false });
    expect((await call("GET", `/unsubscribe?token=${a.token}`)).body).toEqual({
      valid: false,
      action: null,
      postTitle: null,
    });
  });

  it("gives each status-change mail recipient its own one-click link", async () => {
    const env = contractEnv();
    const { postId } = await customerPost(env, env.a);
    const principalId = await env.scoped(
      env.a,
      async (_db, actor) => actor.principalId as PrincipalId,
    );
    const content = await withQuillsSystemWorkspace(env.a, (db) =>
      subscribers["post.status_changed"]!.mail!(
        db,
        {
          eventId: "event_test",
          type: "post.status_changed",
          entityType: "post",
          entityId: postId,
          actorId: null,
          payload: {},
          context: {},
          occurredAt: new Date(),
        },
        principalId,
      ),
    );
    expect(content).toMatchObject({
      type: "post_status_changed",
      emailType: "StatusChangeEmail",
      postId,
    });
    const tokens = await env.scoped(env.a, (db) =>
      db
        .select({
          action: unsubscribeTokens.action,
          postId: unsubscribeTokens.postId,
        })
        .from(unsubscribeTokens)
        .where(eq(unsubscribeTokens.principalId, principalId)),
    );
    expect(tokens).toContainEqual({ action: "unsubscribe_post", postId });
    vi.stubEnv("KANEO_API_URL", "https://kaneo.example/");
    expect(unsubscribeUrl(env.a, "abc")).toBe(
      `https://kaneo.example/api/quills-public/${env.a}/unsubscribe?token=abc`,
    );
  });

  it("refuses a status component of another workspace", async () => {
    const env = contractEnv();
    // Opens the portal and the status page, so a 404 comes from the foreign component.
    await openPublic(env);
    const foreign = await env.scoped(env.b, async (db) => {
      const [row] = await db
        .insert(statusComponents)
        .values({ name: env.id("component") })
        .returning({ id: statusComponents.id });
      return row!.id;
    });
    const res = await call("PUT", "/status/subscription", {
      user: env.customerA,
      body: { scope: "components", componentIds: [foreign] },
    });
    expect(res.status).toBe(404);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.status_subscriptions WHERE workspace_id=$1",
          [env.a],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("keeps the widget hero image key in the storage lifecycle", async () => {
    const env = contractEnv();
    const first = env.id("hero/first.png");
    const second = env.id("hero/second.png");
    const set = (key: string | null) =>
      env.scoped(env.a, (db) =>
        db.update(settings).set({ widgetHeroKey: key }),
      );
    await set(first);
    const referenced = async (key: string) =>
      (
        await pool.query(
          "SELECT quills.storage_object_is_referenced($1) AS r",
          [key],
        )
      ).rows[0].r;
    expect(await referenced(first)).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT quills.storage_keys_for_workspace($1) AS key",
          [env.a],
        )
      ).rows.map((row) => row.key),
    ).toContain(first);
    expect(
      (
        await pool.query(
          "SELECT object_key FROM quills.storage_references() WHERE workspace_id=$1",
          [env.a],
        )
      ).rows.map((row) => row.object_key),
    ).toContain(first);
    // Replacing and clearing queue the old key for the shared cleanup in the same transaction.
    await set(second);
    await set(null);
    const queued = await pool.query(
      "SELECT object_key FROM public.storage_cleanup WHERE object_key = ANY($1)",
      [[first, second]],
    );
    expect(queued.rows.map((row) => row.object_key).sort()).toEqual(
      [first, second].sort(),
    );
    expect(await referenced(second)).toBe(false);
    expect(
      collectStorageKeys({ settings: [{ widget_hero_key: first }] }),
    ).toEqual([first]);
  });

  it("applies bounded identify claims and returns the voted posts", async () => {
    const env = contractEnv();
    const secret = await enableWidget(env, env.a);
    const { postId } = await customerPost(env, env.a);
    const seeded = await env.scoped(env.a, async (db) => {
      await db.insert(userAttributeDefinitions).values([
        { key: "plan", label: "Plan", type: "string" },
        { key: "seats", label: "Seats", type: "number" },
      ]);
      const [vip, kept] = await db
        .insert(segments)
        .values([
          { name: "VIP", slug: env.id("vip"), type: "manual" },
          { name: "Kept", slug: env.id("kept"), type: "manual" },
        ])
        .returning({ id: segments.id, slug: segments.slug });
      return { vip: vip!, kept: kept! };
    });
    const sub = env.id("claims");
    const identify = (claims: Record<string, unknown>) =>
      call("POST", "/widget/identify", {
        body: {
          ssoToken: signIdentity(
            {
              sub,
              email: `${sub}@example.test`,
              exp: Math.floor(Date.now() / 1000) + 300,
              ...claims,
            },
            secret,
          ),
        },
      });
    const first = await identify({
      plan: "pro",
      seats: "12",
      unknown: "dropped",
      segments: [seeded.vip.slug, "missing", 42],
    });
    expect(first.status).toBe(200);
    const principalId = first.body.principalId as PrincipalId;
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ metadata: customer.metadata })
        .from(customer)
        .where(eq(customer.id, first.body.user.id)),
    );
    expect(JSON.parse(row!.metadata!)).toEqual({ plan: "pro", seats: 12 });
    const memberships = () =>
      env.scoped(env.a, (db) =>
        db
          .select({
            segmentId: userSegments.segmentId,
            by: userSegments.addedBy,
          })
          .from(userSegments)
          .where(eq(userSegments.principalId, principalId)),
      );
    expect(await memberships()).toEqual([
      { segmentId: seeded.vip.id, by: "widget" },
    ]);
    const changelog = () =>
      env.scoped(env.a, (db) =>
        db
          .select({
            source: changelogSubscriptions.source,
            unsubscribedAt: changelogSubscriptions.unsubscribedAt,
          })
          .from(changelogSubscriptions)
          .where(eq(changelogSubscriptions.principalId, principalId)),
      );
    expect(await changelog()).toEqual([
      { source: "auto", unsubscribedAt: null },
    ]);

    // A manual membership and an unsubscribe outlast later identifies; widget memberships follow the claim.
    await env.scoped(env.a, async (db) => {
      await db
        .insert(userSegments)
        .values({ principalId, segmentId: seeded.kept.id, addedBy: "manual" });
      await db
        .update(changelogSubscriptions)
        .set({ unsubscribedAt: new Date() })
        .where(eq(changelogSubscriptions.principalId, principalId));
      await db
        .insert(postVotes)
        .values({ postId: postId as PostId, principalId });
    });
    const second = await identify({});
    expect(second.body.votedPostIds).toEqual([postId]);
    expect(await memberships()).toEqual([
      { segmentId: seeded.kept.id, by: "manual" },
    ]);
    expect((await changelog())[0]!.unsubscribedAt).not.toBeNull();
  });

  it("stores only the hash of a push token", async () => {
    const env = contractEnv();
    const token = env.id("apns");
    const registered = await call("POST", "/devices", {
      user: env.owner,
      teammate: true,
      body: { token, platform: "ios" },
    });
    expect(registered.status).toBe(200);
    const rows = await pool.query(
      "SELECT token FROM quills.push_devices WHERE workspace_id=$1",
      [env.a],
    );
    expect(rows.rows).toEqual([{ token: hashToken(token) }]);
  });
});
