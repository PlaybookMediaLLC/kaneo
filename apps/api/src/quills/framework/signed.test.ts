import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createId, toUuid } from "@kaneo/ids";
import { emailLog } from "../../database/quills/schema/email-log";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  QuillsWorkspaceUnavailable,
  withQuillsSigned,
} from "../../database/quills/client";
import { eq } from "drizzle-orm";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { integrations } from "../../database/quills/schema/integrations";
import { posts } from "../../database/quills/schema/posts";
import { integrationPlatformCredentials } from "../../database/quills/schema/integrations";
import {
  decryptSecret,
  encryptSecret,
} from "../../notification-preferences/secrets";
import { postStatuses } from "../../database/quills/schema/statuses";
import * as kaneo from "../../database/schema";
import { apiRouter } from "../../openapi";
import { oauthConnection } from "../integrations/oauth-seed.fixture";
import { post } from "../integrations/seed.fixture";
import quillsRouter from "../index";
import { providerOverrides } from "../integrations/provider-edge.fixture";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "./contract";
import { memberHoldsQuillsAction, portalAccount } from "./platform-reads";
import {
  inboundLabel,
  mailTags,
  mintOAuthState,
  outboundMessageId,
  ownMessageIds,
  readMailTags,
  replyAddress,
  replyAddressConversation,
  safeEqual,
  verifySvixSignature,
} from "./signed";

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
const url = process.env.QUILLS_TEST_DATABASE_URL;

const KEY = Buffer.from("signed-test-key").toString("base64");
const svix = (raw: string, secret = `whsec_${KEY}`, at = Date.now()) => {
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(at / 1000));
  const signature = createHmac(
    "sha256",
    Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
  )
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return new Headers({
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v2,abc v1,${signature}`,
  });
};

describe("signed verifiers without a database", () => {
  it("compares in constant time and refuses empty values", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("a", "a".repeat(64))).toBe(false);
  });
  it("checks the Svix signature, its key and its timestamp window", () => {
    const raw = '{"type":"email.received"}';
    const headers = svix(raw);
    expect(verifySvixSignature({ raw, headers }, `whsec_${KEY}`)).toBe(
      headers.get("webhook-id"),
    );
    expect(
      verifySvixSignature({ raw: `${raw} `, headers }, `whsec_${KEY}`),
    ).toBeNull();
    expect(
      verifySvixSignature(
        { raw, headers },
        `whsec_${Buffer.from("other").toString("base64")}`,
      ),
    ).toBeNull();
    const stale = svix(raw, `whsec_${KEY}`, Date.now() - 6 * 60 * 1000);
    expect(
      verifySvixSignature({ raw, headers: stale }, `whsec_${KEY}`),
    ).toBeNull();
    expect(
      verifySvixSignature({ raw, headers: new Headers() }, `whsec_${KEY}`),
    ).toBeNull();
  });
  it("mints reply addresses that only verify for their own workspace and conversation", () => {
    process.env.EMAIL_INBOUND_SIGNING_SECRET = `whsec_${KEY}`;
    process.env.EMAIL_INBOUND_DOMAIN = "in.example.test";
    const conversation = createId("conversation");
    // A workspace as Better Auth creates it: a 32-character mixed-case ID and a lower-case slug.
    const workspace = { id: "Qx7bN2kLmP9vR4tYwZ1cD5fG8hJ3sA6e", slug: "acme" };
    const address = replyAddress(workspace, conversation)!;
    expect(address).toMatch(/^acme\+c[0-9a-z]{38}@in\.example\.test$/);
    expect(address.split("@")[0]!.length).toBeLessThanOrEqual(64);
    expect(
      replyAddressConversation(
        [`Ada <${address.toUpperCase()}>`],
        workspace.id,
      ),
    ).toBe(conversation);
    // Another workspace, another conversation or a changed tag never verifies.
    expect(replyAddressConversation([address], "ws_b")).toBeNull();
    const other = replyAddress(workspace, createId("conversation"))!;
    expect(
      replyAddressConversation(
        [`${address.slice(0, 6)}${other.slice(6, 32)}${address.slice(32)}`],
        workspace.id,
      ),
    ).toBeNull();
    const at = address.indexOf("@");
    const flipped = `${address.slice(0, at - 1)}${address[at - 1] === "0" ? "1" : "0"}${address.slice(at)}`;
    expect(replyAddressConversation([flipped], workspace.id)).toBeNull();
    // A slug past 24 characters (a local part past 64) or not lower-case is never minted.
    expect(
      replyAddress({ id: workspace.id, slug: "w".repeat(25) }, conversation),
    ).toBeNull();
    expect(
      replyAddress({ id: workspace.id, slug: "Acme" }, conversation),
    ).toBeNull();
    // Our own Message-IDs name their message; another host's, or a malformed ID, do not.
    const message = createId("conversation_message");
    expect(outboundMessageId(message)).toBe(`<${message}@in.example.test>`);
    expect(
      ownMessageIds([
        `<${message}@IN.example.test>`,
        `<${message}@evil.test>`,
        "<x@in.example.test>",
        `<conversation_msg_${"z".repeat(26)}@in.example.test>`,
      ]),
    ).toEqual([message]);
  });
  it("signs mail tags so another sender cannot name a workspace", () => {
    process.env.EMAIL_INBOUND_SIGNING_SECRET = `whsec_${KEY}`;
    const log = createId("email_log");
    const tags = mailTags("ws_a", log);
    const map = Object.fromEntries(tags.map((t) => [t.name, t.value]));
    expect(readMailTags(map)).toEqual({ workspaceId: "ws_a", logId: log });
    expect(readMailTags(tags)).toEqual({ workspaceId: "ws_a", logId: log });
    expect(readMailTags({ ...map, kaneo_workspace: "ws_b" })).toBeNull();
    expect(
      readMailTags({ ...map, kaneo_log: createId("email_log") }),
    ).toBeNull();
    expect(readMailTags({ ...map, kaneo_sig: undefined })).toBeNull();
    expect(readMailTags(undefined)).toBeNull();
  });
  it("reads the workspace label of an inbound address", () => {
    const domain = "in.example.test";
    expect(inboundLabel("acme@in.example.test", domain)).toBe("acme");
    expect(inboundLabel("Support <Acme+c1.tag@IN.example.test>", domain)).toBe(
      "acme",
    );
    expect(inboundLabel("acme@other.test", domain)).toBeNull();
    expect(inboundLabel("@in.example.test", domain)).toBeNull();
    expect(inboundLabel("a b@in.example.test", domain)).toBeNull();
  });
});

describe.skipIf(!url)("signed audience with PostgreSQL", () => {
  const app = contractApp(apiRouter(), publicRouter);
  beforeAll(async () => {
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
      "quills-contract-test-key";
    process.env.EMAIL_INBOUND_SIGNING_SECRET = `whsec_${KEY}`;
    process.env.EMAIL_INBOUND_DOMAIN = "in.example.test";
    process.env.EMAIL_RESEND_API_KEY = "re_contract";
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("resolves an integration's workspace for the application credential only", async () => {
    const env = contractEnv();
    const [row] = await env.scoped(env.a, (db, actor) =>
      db
        .insert(integrations)
        .values({
          integrationType: "github",
          status: "active",
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: integrations.id }),
    );
    const id = toUuid(row!.id);
    const resolved = await pool.query(
      "SELECT quills.integration_workspace($1::uuid) AS w",
      [id],
    );
    expect(resolved.rows[0].w).toBe(env.a);
    const unknown = await pool.query(
      "SELECT quills.integration_workspace($1::uuid) AS w",
      [randomUUID()],
    );
    expect(unknown.rows[0].w).toBeNull();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE quills_runtime");
      await expect(
        client.query("SELECT quills.integration_workspace($1::uuid)", [id]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // The scoped transaction sees only that workspace's rows.
    const seen = await withQuillsSigned(
      { integration: id },
      async (db, ws) => ({
        ws: ws.id,
        rows: await db.select({ id: integrations.id }).from(integrations),
      }),
    );
    expect(seen.ws).toBe(env.a);
    expect(seen.rows.map((r) => r.id)).toContain(row!.id);
    await expect(
      withQuillsSigned({ integration: randomUUID() }, async () => null),
    ).rejects.toBeInstanceOf(QuillsWorkspaceUnavailable);
  });

  const mail = (
    to: string,
    from: string,
    messageId: string,
    inReplyTo?: string,
  ) => {
    const raw = JSON.stringify({
      type: "email.received",
      data: {
        from,
        to: [`${to}@in.example.test`],
        subject: "Help",
        text: `Hello ${messageId}`,
        headers: {
          "message-id": messageId,
          ...(inReplyTo && { "in-reply-to": inReplyTo }),
        },
      },
    });
    return app.request("/quills-public/signed/chat/email/inbound", {
      method: "POST",
      headers: svix(raw),
      body: raw,
    });
  };
  const messagesOf = async (messageId: string) =>
    (
      await pool.query(
        `SELECT m.conversation_id FROM quills.conversation_messages m WHERE m.workspace_id=$1 AND m.metadata->>'emailMessageId'=$2`,
        [contractEnv().a, messageId],
      )
    ).rows.map((r) => r.conversation_id as string);

  it("appends a reply from the same sender and refuses one from another sender", async () => {
    const env = contractEnv();
    const sender = `ada-${randomUUID()}@customer.test`;
    const first = `<${randomUUID()}@customer.test>`;
    expect(
      await (await mail(env.a, `Ada <${sender}>`, first)).json(),
    ).toMatchObject({
      status: "received",
    });
    const reply = `<${randomUUID()}@customer.test>`;
    expect(
      await (await mail(env.a, sender, reply, first)).json(),
    ).toMatchObject({
      status: "received",
    });
    const [conversation] = await messagesOf(first);
    expect(await messagesOf(reply)).toEqual([conversation]);
    const spoof = `<${randomUUID()}@customer.test>`;
    expect(
      await (await mail(env.a, "mallory@evil.test", spoof, first)).json(),
    ).toEqual({ status: "from_mismatch", messageId: null });
    expect(await messagesOf(spoof)).toEqual([]);
    // The same Message-ID in a new delivery changes nothing.
    expect(await (await mail(env.a, sender, reply, first)).json()).toEqual({
      status: "duplicate",
      messageId: null,
    });
  });
  it("records a bounce on the mail's own log row, once, and never for unsigned tags", async () => {
    const env = contractEnv();
    const [row] = await env.scoped(env.a, (db) =>
      db
        .insert(emailLog)
        .values({
          direction: "outbound",
          emailType: "ConversationReplyEmail",
          address: "ada@customer.test",
          status: "sent",
        })
        .returning({ id: emailLog.id }),
    );
    const tags = Object.fromEntries(
      mailTags(env.a, row!.id).map((t) => [t.name, t.value]),
    );
    const deliver = (type: string, data: Record<string, unknown>) => {
      const raw = JSON.stringify({ type, data });
      return app.request("/quills-public/signed/chat/email/events", {
        method: "POST",
        headers: svix(raw),
        body: raw,
      });
    };
    const status = async () =>
      (
        await env.scoped(env.a, (db) =>
          db
            .select({ status: emailLog.status })
            .from(emailLog)
            .where(eq(emailLog.id, row!.id)),
        )
      )[0]!.status;
    expect(await (await deliver("email.delivered", { tags })).json()).toEqual({
      status: "ignored",
    });
    expect(await status()).toBe("sent");
    expect(await (await deliver("email.bounced", { tags })).json()).toEqual({
      status: "recorded",
    });
    expect(await status()).toBe("bounced");
    // Tags that this instance did not sign name no workspace.
    expect(
      (
        await deliver("email.complained", {
          tags: { ...tags, kaneo_sig: "0".repeat(32) },
        })
      ).status,
    ).toBe(404);
    expect((await deliver("email.complained", {})).status).toBe(404);
    expect(await status()).toBe("bounced");
  });
  it("answers 404 for an address no workspace owns, and while unconfigured", async () => {
    expect((await mail("nobody-here", "a@b.test", "<x@b.test>")).status).toBe(
      404,
    );
    const secret = process.env.EMAIL_INBOUND_SIGNING_SECRET;
    delete process.env.EMAIL_INBOUND_SIGNING_SECRET;
    try {
      expect(
        (await mail(contractEnv().a, "a@b.test", "<y@b.test>")).status,
      ).toBe(404);
    } finally {
      process.env.EMAIL_INBOUND_SIGNING_SECRET = secret;
    }
  });
  it("applies a status webhook once and ignores an older event that arrives later", async () => {
    const env = contractEnv();
    const secret = `whsec-${randomUUID()}`;
    const { open, closed } = await env.scoped(env.a, async (db) => {
      const rows = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .limit(2);
      return { open: rows[0]!.id, closed: rows[1]!.id };
    });
    const integrationId = await oauthConnection(env, env.a, {
      webhookSecret: secret,
      config: {
        statusMappings: { Closed: closed, Open: open },
        statusSync: { target: "acme:app", hookId: "1", state: "active" },
      },
    });
    const postId = await post(env, env.a);
    await env.scoped(env.a, (db) =>
      db.insert(postExternalLinks).values({
        postId,
        integrationId,
        integrationType: "github",
        externalId: "acme/app#41",
      }),
    );
    const send = (action: string, at: Date) => {
      const raw = JSON.stringify({
        action,
        issue: { number: 41, updated_at: at.toISOString() },
        repository: { full_name: "acme/app" },
      });
      return app.request(
        `/quills-public/signed/integrations/github/${integrationId}/webhook`,
        {
          method: "POST",
          headers: {
            "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
          },
          body: raw,
        },
      );
    };
    const statusOf = async () =>
      (
        await env.scoped(env.a, (db) =>
          db
            .select({ statusId: posts.statusId })
            .from(posts)
            .where(eq(posts.id, postId)),
        )
      )[0]!.statusId;
    expect(await (await send("closed", new Date())).json()).toMatchObject({
      applied: 1,
    });
    expect(await statusOf()).toBe(closed);
    // A reopen signed earlier than the close, delivered after it: no change.
    expect(
      await (await send("reopened", new Date(Date.now() - 60_000))).json(),
    ).toMatchObject({ applied: 0 });
    expect(await statusOf()).toBe(closed);
    // An event older than the receipt window: no change either.
    expect(
      await (
        await send("reopened", new Date(Date.now() - 40 * 86_400_000))
      ).json(),
    ).toMatchObject({ applied: 0 });
    expect(await statusOf()).toBe(closed);
  });

  it("re-checks the OAuth caller's role: members without the action, removed members and archived workspaces are refused", async () => {
    const env = contractEnv();
    const user = (role: string) => env.owner.replace(/_owner$/, `_${role}`);
    const holds = (userId: string) =>
      memberHoldsQuillsAction(env.a, userId, "manage_settings");
    expect(await holds(env.owner)).toBe(true);
    // Instance administrators keep Kaneo's override without membership.
    expect(await holds(user("admin"))).toBe(true);
    expect(await holds(user("limited"))).toBe(false);
    expect(await holds(user("removed"))).toBe(false);
    expect(await holds(env.customerA)).toBe(false);
    await pool.query(
      "UPDATE public.workspace SET archived_at=now() WHERE id=$1",
      [env.a],
    );
    try {
      expect(await holds(env.owner)).toBe(false);
    } finally {
      await pool.query(
        "UPDATE public.workspace SET archived_at=NULL WHERE id=$1",
        [env.a],
      );
    }
    // The route answers 403 for a valid state of a member who lost the action.
    const state = mintOAuthState({
      workspaceId: env.a,
      userId: user("limited"),
      type: "github",
    });
    const res = await app.request(
      `/quills-public/signed/oauth/github/callback?state=${encodeURIComponent(state)}&code=c`,
      { headers: { "x-test-user": user("limited") } },
    );
    expect(res.status).toBe(403);
  });

  it("marks a portal account as a member only for a workspace that it belongs to", async () => {
    const env = contractEnv();
    expect((await portalAccount(env.a, env.owner))?.member).toBe(true);
    expect((await portalAccount(env.b, env.owner))?.member).toBe(false);
    expect((await portalAccount(env.a, env.customerA))?.member).toBe(false);
  });

  it("verifies a GitLab token, applies a close, and refuses deliveries once status sync is off", async () => {
    const env = contractEnv();
    const secret = `glsecret-${randomUUID()}`;
    const [closed] = await env.scoped(env.a, (db) =>
      db.select({ id: postStatuses.id }).from(postStatuses).limit(1),
    );
    const [row] = await env.scoped(env.a, async (db, actor) => {
      await db
        .delete(integrations)
        .where(eq(integrations.integrationType, "gitlab"));
      return db
        .insert(integrations)
        .values({
          integrationType: "gitlab",
          status: "active",
          secrets: encryptSecret(
            JSON.stringify({ accessToken: "t", webhookSecret: secret }),
          )!,
          config: {
            statusMappings: { closed: closed!.id },
            statusSync: { target: "12", hookId: "1", state: "active" },
          },
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        })
        .returning({ id: integrations.id });
    });
    const postId = await post(env, env.a);
    await env.scoped(env.a, (db) =>
      db.insert(postExternalLinks).values({
        postId,
        integrationId: row!.id,
        integrationType: "gitlab",
        externalId: "12#5",
      }),
    );
    const send = (token: string, action = "close") =>
      app.request(
        `/quills-public/signed/integrations/gitlab/${row!.id}/webhook`,
        {
          method: "POST",
          headers: { "x-gitlab-token": token },
          body: JSON.stringify({
            object_kind: "issue",
            object_attributes: {
              iid: 5,
              action,
              updated_at: new Date().toISOString(),
            },
            project: { id: 12 },
            repository: { name: "app", url: "https://gitlab.com/acme/app" },
          }),
        },
      );
    expect((await send("wrong")).status).toBe(401);
    expect(await (await send(secret)).json()).toMatchObject({ applied: 1 });
    // Status sync off: the stale secret no longer verifies.
    await env.scoped(env.a, (db) =>
      db
        .update(integrations)
        .set({ config: {} })
        .where(eq(integrations.id, row!.id)),
    );
    expect((await send(secret, "reopen")).status).toBe(401);
  });

  it("fetches the body from Resend when the event carries none", async () => {
    const env = contractEnv();
    const messageId = `<${randomUUID()}@customer.test>`;
    const raw = JSON.stringify({
      type: "email.received",
      data: {
        email_id: "em_contract",
        from: `grace-${randomUUID()}@customer.test`,
        to: [`${env.a}@in.example.test`],
        headers: { "message-id": messageId },
      },
    });
    const res = await app.request("/quills-public/signed/chat/email/inbound", {
      method: "POST",
      headers: svix(raw),
      body: raw,
    });
    expect(await res.json()).toMatchObject({ status: "received" });
    const { rows } = await pool.query(
      "SELECT content FROM quills.conversation_messages WHERE workspace_id=$1 AND metadata->>'emailMessageId'=$2",
      [env.a, messageId],
    );
    expect(rows.map((r) => r.content)).toEqual(["Body from Resend"]);
  });

  it("keeps a refreshed GitLab token when the provider call after the refresh fails", async () => {
    const env = contractEnv();
    const teammateApp = contractApp(quillsRouter, publicRouter);
    const [row] = await env.scoped(env.a, async (db, actor) => {
      await db
        .delete(integrations)
        .where(eq(integrations.integrationType, "gitlab"));
      await db
        .delete(integrationPlatformCredentials)
        .where(eq(integrationPlatformCredentials.integrationType, "gitlab"));
      await db.insert(integrationPlatformCredentials).values({
        integrationType: "gitlab",
        secrets: encryptSecret(
          JSON.stringify({ clientId: "c", clientSecret: "s" }),
        )!,
      });
      return db
        .insert(integrations)
        .values({
          integrationType: "gitlab",
          status: "active",
          secrets: encryptSecret(
            JSON.stringify({
              accessToken: "expired",
              refreshToken: "glrt_old",
              expiresAt: new Date(Date.now() - 1000).toISOString(),
              webhookSecret: "kept",
            }),
          )!,
          config: {},
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        })
        .returning({ id: integrations.id });
    });
    providerOverrides.set("GET /gitlab.com/api/v4/projects", { status: 500 });
    try {
      const res = await teammateApp.request(
        `/quills/${env.a}/integrations/${row!.id}/destinations`,
        { headers: { "x-test-user": env.owner } },
      );
      expect(res.status).toBe(502);
    } finally {
      providerOverrides.clear();
    }
    const [stored] = await env.scoped(env.a, (db) =>
      db
        .select({ secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.id, row!.id)),
    );
    expect(JSON.parse(decryptSecret(stored!.secrets)!)).toMatchObject({
      accessToken: "glpat_contract_token",
      refreshToken: "glrt_contract_token",
      webhookSecret: "kept",
    });
  });
});
