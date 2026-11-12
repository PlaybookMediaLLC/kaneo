import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import { boards } from "../../../database/quills/schema/boards";
import { postExternalLinks } from "../../../database/quills/schema/external-links";
import { integrationSyncOperations as operations } from "../../../database/quills/schema/integration-sync";
import {
  integrationPlatformCredentials,
  integrations,
} from "../../../database/quills/schema/integrations";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { postComments, posts } from "../../../database/quills/schema/posts";
import * as kaneo from "../../../database/schema";
import {
  decryptSecret,
  encryptSecret,
} from "../../../notification-preferences/secrets";
import type { BaseVariables } from "../../../openapi";
import router from "../..";
import type { DeliveredEvent } from "../../integrations/catalog";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { validTarget } from "../../integrations/providers";
import { TEAMS_TEAM } from "../../integrations/providers/teams.fixture";
import { enqueueQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { fanOutIntegrations } from "./integration";
import { deliver, type Delivery } from "./integration-send";

// Microsoft Teams channel messages through the worker, against real PostgreSQL and the local provider
// server (integrations/provider-edge.fixture.ts). The evidence of tracker-delivery.fixture.ts, for a
// message: a message has no link, and a 5xx waits for a retry (a message may repeat). No test reaches
// Microsoft.

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("teams_delivery");
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
  "quills-integration-test-key";

const CHANNEL = `${TEAMS_TEAM}:19:contract@thread.tacv2`;
const OTHER_CHANNEL = `${TEAMS_TEAM}:19:other@thread.tacv2`;
/** The message call of CHANNEL: each ID encoded in the Graph path. */
const MESSAGES = `POST /graph.microsoft.com/v1.0/teams/${TEAMS_TEAM}/channels/19%3Acontract%40thread.tacv2/messages`;
const TOKEN = "POST /login.microsoftonline.com/organizations/oauth2/v2.0/token";
const SCOPES = "Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send";
const CONTENT = "First line\n\n<script>alert(1)</script> & **bold**";
/** CONTENT of a new post titled "Integration post", as escaped Teams HTML. */
const CREATED_HTML =
  "New feedback: Integration post<br>First line<br><br>&lt;script&gt;alert(1)&lt;/script&gt; &amp; **bold**";

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const tokens = (workspaceId: string) => ({
  accessToken: `teams_${workspaceId}`,
  refreshToken: `teams_refresh_${workspaceId}`,
  expiresAt: future(),
});

/** Runs before each provider request, with its `METHOD /<host><path>`; it may wait. */
let beforeSend: ((route: string) => Promise<void> | void) | undefined;
/** The content type of each provider request, in order (the edge does not record it). */
const sent: { route: string; contentType: string }[] = [];
const edge = vi.mocked(globalThis.fetch).getMockImplementation()!;
vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  const route = `${init?.method ?? "GET"} /${target.hostname}${target.pathname}`;
  sent.push({
    route,
    contentType: new Headers(init?.headers).get("content-type") ?? "",
  });
  await beforeSend?.(route);
  return edge(input, init);
});
/** Answers `route` with each value in turn, then with the server's own answer. */
const answers = (
  route: string,
  ...values: ({ status: number; body?: unknown } | "drop")[]
) => {
  beforeSend = (request) => {
    if (request !== route) return;
    const next = values.shift();
    if (next) providerOverrides.set(route, next);
    else providerOverrides.delete(route);
  };
};
const messages = () =>
  providerCalls.filter((call) => `${call.method} ${call.path}` === MESSAGES);
const content = (n: number) =>
  (JSON.parse(messages()[n]!.body) as { body: { content: string } }).body
    .content;

describe("Microsoft Teams target rule and message body", () => {
  afterEach(() => {
    providerOverrides.clear();
    providerCalls.length = 0;
  });

  it("accepts real-shaped channel IDs and refuses other shapes", () => {
    // Microsoft Graph examples: a standard, a shared and an older channel ID.
    const shared =
      "6a720ba5-7373-463b-bc9f-4cd04b5c6742:19:LpxShHZZh9utjNcEmUS5aOEP9ASw85OUn05NcWYAhX81@thread.tacv2";
    expect(shared).toHaveLength(97);
    for (const target of [
      CHANNEL,
      "fbe2bf47-16c8-47cf-b4a5-4b9b187c508b:19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2",
      shared,
      `${TEAMS_TEAM}:19:09fc54a3141a45d0bc769cf506d2e079@thread.skype`,
    ])
      expect(validTarget("teams", target), target).toBe(true);
    for (const target of [
      "",
      TEAMS_TEAM,
      "19:contract@thread.tacv2",
      `${TEAMS_TEAM}:`,
      `${TEAMS_TEAM}19:contract@thread.tacv2`,
      `not-a-guid:19:contract@thread.tacv2`,
      `${TEAMS_TEAM}:../escape`,
      `${TEAMS_TEAM}:19:a/b@thread.tacv2`,
      `${TEAMS_TEAM}:19:a\\b@thread.tacv2`,
      `${TEAMS_TEAM}:19:a?b@thread.tacv2`,
      `${TEAMS_TEAM}:19:a#b@thread.tacv2`,
      `${TEAMS_TEAM}:19:a%2Fb@thread.tacv2`,
      `${TEAMS_TEAM}:19:a\nb@thread.tacv2`,
      `${TEAMS_TEAM}:19:a b@thread.tacv2`,
      `${TEAMS_TEAM}:19:a:b@thread.tacv2`,
      `${TEAMS_TEAM}:19:a@evil.example`,
      `${TEAMS_TEAM}:19:a@thread.tacv2/../x`,
      `${TEAMS_TEAM}:19:<at>a</at>@thread.tacv2`,
      // 101 characters.
      `${TEAMS_TEAM}:19:${"a".repeat(48)}@thread.tacv2`,
    ])
      expect(validTarget("teams", target), JSON.stringify(target)).toBe(false);
    expect(`${TEAMS_TEAM}:19:${"a".repeat(48)}@thread.tacv2`).toHaveLength(101);
    expect(
      validTarget("teams", `${TEAMS_TEAM}:19:${"a".repeat(47)}@thread.tacv2`),
    ).toBe(true);
  });

  const delivery = (
    type: DeliveredEvent,
    post: { title: string; content: string },
  ): Delivery => ({
    provider: "teams",
    credentials: { accessToken: "teams-unit" },
    config: { scopes: SCOPES },
    target: CHANNEL,
    type,
    occurredAt: new Date(),
    content: {
      board: "ideas",
      boardId: "board_1",
      post: { id: "post_1", author: "Ada", ...post },
      statusName: "Done <b>",
      comment: { id: "comment_1", content: post.content, author: "Ada" },
    },
    deliveryId: "op_1",
  });

  it("escapes a hostile title and body for each event, and encodes the Graph path", async () => {
    const title = `<at id="0">Everyone</at> @channel <attachment id="1"></attachment> "q" 'a' & b`;
    const escaped = `&lt;at id=&quot;0&quot;&gt;Everyone&lt;/at&gt; @channel &lt;attachment id=&quot;1&quot;&gt;&lt;/attachment&gt; &quot;q&quot; &#39;a&#39; &amp; b`;
    const body = "<img src=x onerror=alert(1)>\n<p>Hi</p>";
    const escapedBody =
      "&lt;img src=x onerror=alert(1)&gt;<br>&lt;p&gt;Hi&lt;/p&gt;";
    for (const [type, expected] of [
      ["post.created", `New feedback: ${escaped}<br>${escapedBody}`],
      ["post.status_changed", `Status changed: ${escaped} → Done &lt;b&gt;`],
      ["comment.created", `New comment on ${escaped}<br>${escapedBody}`],
    ] as const) {
      providerCalls.length = 0;
      expect(await deliver(delivery(type, { title, content: body }))).toEqual({
        state: "succeeded",
        refreshed: undefined,
      });
      const [call] = providerCalls;
      expect(`${call!.method} ${call!.path}`).toBe(MESSAGES);
      expect(call!.authorization).toBe("Bearer teams-unit");
      // Only the HTML body: no mentions list, no attachments.
      expect(JSON.parse(call!.body)).toEqual({
        body: { contentType: "html", content: expected },
      });
    }
  });

  it("bounds the message far below the Teams post limit", async () => {
    await deliver(
      delivery("post.created", {
        title: '"'.repeat(10_000),
        content: "<".repeat(10_000),
      }),
    );
    const sentContent = (
      JSON.parse(providerCalls[0]!.body) as { body: { content: string } }
    ).body.content;
    // chatText keeps 1,900 characters; the widest escape (&quot;) has six.
    expect(Buffer.byteLength(sentContent)).toBeLessThanOrEqual(1_900 * 6);
  });
});

const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("*", async (c, next) => {
  c.set("userId", c.req.header("x-user") ?? h.owner);
  c.set("user", null);
  await next();
});
app.route("/quills", router);
const owner = (workspaceId: string) =>
  workspaceId === h.a ? h.owner : h.outsider;
const call = (
  path: string,
  method = "GET",
  body?: unknown,
  workspaceId = h.a,
) =>
  app.request(`/quills/${workspaceId}${path}`, {
    method,
    headers: {
      "x-user": owner(workspaceId),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const seal = (values: Record<string, string>) =>
  encryptSecret(JSON.stringify(values))!;

/** A Teams connection, its OAuth app and its channel for every event (through the channel route). */
async function connect(
  workspaceId = h.a,
  config: Record<string, unknown> = { scopes: SCOPES },
) {
  const id = await h.as(workspaceId, owner(workspaceId), async (db, actor) => {
    await db
      .delete(integrations)
      .where(eq(integrations.integrationType, "teams"));
    await db
      .delete(integrationPlatformCredentials)
      .where(eq(integrationPlatformCredentials.integrationType, "teams"));
    await db.insert(integrationPlatformCredentials).values({
      integrationType: "teams",
      secrets: seal({ clientId: "client", clientSecret: "app-secret" }),
    });
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: "teams",
        status: "active",
        secrets: seal(tokens(workspaceId)),
        config: { workspaceName: "Microsoft Teams", account: null, ...config },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(Date.now() - 1000),
      })
      .returning({ id: integrations.id });
    return row!.id;
  });
  const res = await call(
    `/integrations/${id}/channels`,
    "POST",
    {
      channel: CHANNEL,
      events: ["post.created", "post.status_changed", "comment.created"],
    },
    workspaceId,
  );
  expect(res.status).toBe(200);
  return id;
}
async function makePost(workspaceId = h.a) {
  return h.as(workspaceId, owner(workspaceId), async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Board", slug: `board-${randomUUID()}` })
      .returning({ id: boards.id });
    const [post] = await db
      .insert(posts)
      .values({
        title: "Integration post",
        content: CONTENT,
        boardId: board!.id,
        principalId: actor.principalId,
      })
      .returning({ id: posts.id });
    return post!.id;
  });
}
const created = (postId: string, workspaceId = h.a) =>
  h.emit(workspaceId, {
    type: "post.created",
    entityType: "post",
    entityId: postId,
  });
const ops = (integrationId: string, workspaceId = h.a) =>
  h.system(workspaceId, (db) =>
    db
      .select()
      .from(operations)
      .where(eq(operations.integrationId, integrationId))
      .orderBy(operations.createdAt),
  );
const job = async (operationId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(like(jobQueue.dedupeKey, `integration:${operationId}:%`))
        .orderBy(jobQueue.id),
    )
  ).at(-1)!;
const replay = (id: bigint) =>
  h.system(h.a, (db) =>
    db
      .update(jobQueue)
      .set({
        status: "pending",
        attempts: 0,
        runAt: new Date(0),
        finishedAt: null,
      })
      .where(eq(jobQueue.id, id)),
  );
const links = (postId: string) =>
  h.system(h.a, (db) =>
    db
      .select()
      .from(postExternalLinks)
      .where(eq(postExternalLinks.postId, postId as never)),
  );
const syncItem = async (operationId: string) =>
  (await (await call(`/integration-syncs/${operationId}`)).json()).item;
const secretsOf = async (id: string) => {
  const [row] = await h.system(h.a, (db) =>
    db
      .select({ secrets: integrations.secrets })
      .from(integrations)
      .where(eq(integrations.id, id as never)),
  );
  return JSON.parse(decryptSecret(row!.secrets)!) as Record<string, string>;
};
/** The refresh sent the workspace's OAuth app and the stored refresh token; all new token fields are stored. */
async function refreshedWithApp(id: string) {
  const refresh = providerCalls.find(
    (sent) => `${sent.method} ${sent.path}` === TOKEN,
  )!;
  expect(refresh.body).toContain("app-secret");
  expect(refresh.body).toContain(tokens(h.a).refreshToken);
  const stored = await secretsOf(id);
  expect(stored).toMatchObject({
    accessToken: "teams-contract-token",
    refreshToken: "teams-contract-refresh",
  });
  expect(Date.parse(stored.expiresAt!)).toBeGreaterThan(
    Date.now() + 30 * 60_000,
  );
}
/** A trigger that fails `table`'s `event` when `condition` holds; dropped by the returned function. */
async function failing(table: string, event: string, condition: string) {
  const name = "fu3c_teams_fail";
  await pool.query(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION public.${name}()`,
  );
  return async () => {
    await pool.query(`DROP TRIGGER ${name} ON ${table}`);
    await pool.query(`DROP FUNCTION public.${name}()`);
  };
}

describe.skipIf(!url)("Microsoft Teams delivery", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  beforeEach(async () => {
    beforeSend = undefined;
    providerOverrides.clear();
    providerCalls.length = 0;
    sent.length = 0;
    for (const workspaceId of [h.a, h.b])
      await h.system(workspaceId, (db) => db.delete(integrations));
  });

  it("posts one message per event with no link, and sends nothing new for a replayed job, fan-out or resync", async () => {
    const id = await connect();
    const postId = await makePost();
    const eventId = await created(postId);
    await h.drain(h.a);
    const [op] = await ops(id);
    expect(op).toMatchObject({
      state: "succeeded",
      attempts: 1,
      kind: "create",
      remoteId: null,
    });
    expect(messages()).toHaveLength(1);
    expect(messages()[0]!.authorization).toBe(`Bearer teams_${h.a}`);
    expect(sent.find((request) => request.route === MESSAGES)).toEqual({
      route: MESSAGES,
      contentType: "application/json",
    });
    expect(JSON.parse(messages()[0]!.body)).toEqual({
      body: { contentType: "html", content: CREATED_HTML },
    });
    expect(await links(postId)).toEqual([]);
    expect(await syncItem(op!.id)).toMatchObject({ state: "succeeded" });

    await replay((await job(op!.id)).id);
    await h.drain(h.a);
    await fanOutIntegrations(h.a, eventId);
    expect(
      (await call(`/posts/${postId}/integration-sync`, "POST")).status,
    ).toBe(200);
    await h.drain(h.a);
    expect(messages()).toHaveLength(1);
    expect(await ops(id)).toHaveLength(1);

    // A status change and a public comment: one message each.
    await h.emit(h.a, {
      type: "post.status_changed",
      entityType: "post",
      entityId: postId,
    });
    const commentId = await h.as(h.a, h.owner, async (db, actor) => {
      const [row] = await db
        .insert(postComments)
        .values({
          postId: postId as never,
          principalId: actor.principalId,
          content: 'A <at id="0">comment</at>',
        })
        .returning({ id: postComments.id });
      return row!.id;
    });
    await h.emit(h.a, {
      type: "comment.created",
      entityType: "comment",
      entityId: commentId,
    });
    await h.drain(h.a);
    expect((await ops(id)).map((row) => [row.kind, row.state])).toEqual([
      ["create", "succeeded"],
      ["notify", "succeeded"],
      ["notify", "succeeded"],
    ]);
    expect([content(1), content(2)]).toEqual([
      "Status changed: Integration post",
      "New comment on Integration post<br>A &lt;at id=&quot;0&quot;&gt;comment&lt;/at&gt;",
    ]);
  }, 20_000);

  it("after a reconnect, a resync posts nothing to a channel that got the message, and fills a new channel", async () => {
    const id = await connect();
    const postId = await makePost();
    await created(postId);
    await h.drain(h.a);
    await h.system(h.a, (db) =>
      db
        .update(integrations)
        .set({ connectedAt: new Date() })
        .where(eq(integrations.id, id)),
    );
    expect(
      (
        await call(`/integrations/${id}/channels`, "POST", {
          channel: OTHER_CHANNEL,
          events: ["post.created"],
        })
      ).status,
    ).toBe(200);
    const before = providerCalls.length;
    expect(
      (await call(`/posts/${postId}/integration-sync`, "POST")).status,
    ).toBe(200);
    await h.drain(h.a);
    expect(
      providerCalls.slice(before).map((c) => `${c.method} ${c.path}`),
    ).toEqual([
      `POST /graph.microsoft.com/v1.0/teams/${TEAMS_TEAM}/channels/19%3Aother%40thread.tacv2/messages`,
    ]);
    expect(messages()).toHaveLength(1);
  }, 20_000);

  it("keeps the outcome when the job lease is lost during the send", async () => {
    const id = await connect();
    beforeSend = async (route) => {
      if (route !== MESSAGES) return;
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({ lockedUntil: new Date(0) })
          .where(like(jobQueue.dedupeKey, "integration:%")),
      );
    };
    await created(await makePost());
    await h.drain(h.a);
    expect(messages()).toHaveLength(1);
    const [op] = await ops(id);
    expect(op).toMatchObject({ state: "succeeded", attempts: 1 });
    // The replacement found the recorded outcome and finished the job without a send.
    expect(await job(op!.id)).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
  }, 20_000);

  it("marks a send uncertain when a replacement worker takes the expired lease during it", async () => {
    const id = await connect();
    let replaced = false;
    beforeSend = async (route) => {
      if (route !== MESSAGES || replaced) return;
      replaced = true;
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({ lockedUntil: new Date(0) })
          .where(like(jobQueue.dedupeKey, "integration:%")),
      );
      await h.drain(h.a);
    };
    await created(await makePost());
    await h.drain(h.a);
    expect(replaced).toBe(true);
    // The first worker's call reached Graph once; the replacement sent nothing.
    expect(messages()).toHaveLength(1);
    const [op] = await ops(id);
    expect(op).toMatchObject({
      state: "uncertain",
      errorCode: "outcome_unknown",
    });
    expect(await syncItem(op!.id)).toMatchObject({
      state: "uncertain",
      actions: ["cancel"],
    });
  }, 20_000);

  it("retries a rate limit within the job's limits", async () => {
    const id = await connect();
    answers(MESSAGES, { status: 429 });
    await created(await makePost());
    await h.drain(h.a);
    const [waiting] = await ops(id);
    expect(waiting).toMatchObject({
      state: "retry_wait",
      errorCode: "unavailable",
    });
    expect(await job(waiting!.id)).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    await h.due(h.a);
    await h.drain(h.a);
    expect((await ops(id))[0]).toMatchObject({
      state: "succeeded",
      attempts: 2,
    });
    expect(messages()).toHaveLength(2);
  }, 20_000);

  it("retries a message after a 5xx (it may repeat), and never resends one that got no answer", async () => {
    const id = await connect();
    answers(MESSAGES, { status: 502 });
    await created(await makePost());
    await h.drain(h.a);
    const [waiting] = await ops(id);
    expect(waiting).toMatchObject({
      state: "retry_wait",
      errorCode: "unavailable",
    });
    expect(await job(waiting!.id)).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    await h.due(h.a);
    await h.drain(h.a);
    expect((await ops(id))[0]).toMatchObject({
      state: "succeeded",
      attempts: 2,
    });
    expect(messages()).toHaveLength(2);

    // No answer: Graph may have posted it. Uncertain, and never sent again.
    answers(MESSAGES, "drop");
    await created(await makePost());
    await h.drain(h.a);
    expect(messages()).toHaveLength(3);
    const op = (await ops(id))[1]!;
    expect(op).toMatchObject({
      state: "uncertain",
      errorCode: "outcome_unknown",
    });
    const failed = await job(op.id);
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    await replay(failed.id);
    await h.drain(h.a);
    expect(messages()).toHaveLength(3);
    const item = await syncItem(op.id);
    expect(item).toMatchObject({ state: "uncertain", actions: ["cancel"] });
    expect(item.error).toContain("not sent again");
    expect(
      (
        await call(`/integration-syncs/${op.id}/actions`, "POST", {
          action: "retry",
          version: item.version,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
  }, 20_000);

  it("retries a refresh that got a 5xx, with nothing sent, within the job's limits", async () => {
    const id = await connect();
    await h.system(h.a, (db) =>
      db
        .update(integrations)
        .set({
          secrets: seal({
            ...tokens(h.a),
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        })
        .where(eq(integrations.id, id as never)),
    );
    answers(TOKEN, { status: 503 });
    await created(await makePost());
    await h.drain(h.a);
    const [waiting] = await ops(id);
    expect(waiting).toMatchObject({
      state: "retry_wait",
      errorCode: "unavailable",
    });
    expect(messages()).toHaveLength(0);
    await h.due(h.a);
    await h.drain(h.a);
    expect((await ops(id))[0]).toMatchObject({ state: "succeeded" });
    expect(messages()).toHaveLength(1);
    expect(messages()[0]!.authorization).toBe("Bearer teams-contract-token");
    await refreshedWithApp(id);
  }, 20_000);

  it("refreshes once after a 401, resends once and keeps the new tokens, or asks for a reconnect", async () => {
    const id = await connect();
    answers(MESSAGES, { status: 401 });
    await created(await makePost());
    await h.drain(h.a);
    expect((await ops(id))[0]).toMatchObject({
      state: "succeeded",
      attempts: 1,
    });
    expect(providerCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      MESSAGES,
      TOKEN,
      MESSAGES,
    ]);
    expect(messages()[1]!.authorization).toBe("Bearer teams-contract-token");
    await refreshedWithApp(id);

    // A second 401 after the refresh: a reconnect, with no third call.
    providerCalls.length = 0;
    answers(MESSAGES, { status: 401 }, { status: 401 });
    await created(await makePost());
    await h.drain(h.a);
    expect((await ops(id))[1]).toMatchObject({
      state: "auth_required",
      errorCode: "authentication",
    });
    expect(messages()).toHaveLength(2);
  }, 20_000);

  it("asks for a reconnect on a 403, and without ChannelMessage.Send sends nothing, with no retry", async () => {
    const id = await connect();
    answers(MESSAGES, { status: 403 });
    await created(await makePost());
    await h.drain(h.a);
    const [refused] = await ops(id);
    expect(refused).toMatchObject({
      state: "auth_required",
      errorCode: "authentication",
    });
    expect(messages()).toHaveLength(1);
    expect(await job(refused!.id)).toMatchObject({
      status: "failed",
      attempts: 1,
    });

    // A connection made before delivery (no stored scopes), or one granted the read scopes only.
    for (const scopes of [
      undefined,
      "Team.ReadBasic.All Channel.ReadBasic.All",
    ]) {
      providerCalls.length = 0;
      const readOnly = await connect(h.a, { scopes });
      await created(await makePost());
      await h.drain(h.a);
      const [closed] = await ops(readOnly);
      expect(closed).toMatchObject({
        state: "auth_required",
        errorCode: "write_access_required",
      });
      expect(providerCalls).toEqual([]);
      expect(await job(closed!.id)).toMatchObject({
        status: "failed",
        attempts: 1,
      });
      const message = "Reconnect the integration to grant write access.";
      expect((await syncItem(closed!.id)).error).toBe(message);
      expect(
        (await (await call(`/integrations/${readOnly}`)).json()).integration,
      ).toMatchObject({ lastError: message });
    }
  }, 20_000);

  it("maps a refused answer to a fixed error, and counts a 2xx with any body as sent", async () => {
    const id = await connect();
    answers(MESSAGES, {
      status: 400,
      body: { error: { message: "secret provider text" } },
    });
    await created(await makePost());
    await h.drain(h.a);
    const [refused] = await ops(id);
    expect(refused).toMatchObject({
      state: "failed",
      errorCode: "provider_failed",
    });
    expect(
      await (await call(`/integration-syncs/${refused!.id}`)).text(),
    ).not.toContain("secret provider text");

    // A 2xx without a chatMessage: Graph accepted the message. Sent once, no link.
    answers(MESSAGES, { status: 201, body: { unexpected: true } });
    await created(await makePost());
    await h.drain(h.a);
    expect((await ops(id))[1]).toMatchObject({
      state: "succeeded",
      remoteId: null,
    });
    await h.due(h.a);
    await h.drain(h.a);
    expect(messages()).toHaveLength(2);
  }, 20_000);

  it("uses only the connection of the event's workspace", async () => {
    const own = await connect();
    const foreign = await connect(h.b);
    await created(await makePost());
    await h.drain(h.a);
    await h.drain(h.b);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]!.authorization).toBe(`Bearer teams_${h.a}`);
    expect(await ops(own)).toHaveLength(1);
    expect(await ops(foreign, h.b)).toHaveLength(0);
    // A job in A that names B's operation cannot read it, while B's operation waits to be sent.
    answers(MESSAGES, { status: 429 });
    await created(await makePost(h.b), h.b);
    await h.drain(h.b);
    const [foreignOp] = await ops(foreign, h.b);
    expect(foreignOp).toMatchObject({ state: "retry_wait", attempts: 1 });
    expect(messages()[1]!.authorization).toBe(`Bearer teams_${h.b}`);
    await h.system(h.a, (db) =>
      enqueueQuillsJob(
        db,
        "quills.webhook",
        { operationId: foreignOp!.id },
        `integration:${foreignOp!.id}:9`,
        5,
      ),
    );
    await h.drain(h.a);
    expect(messages()).toHaveLength(2);
    expect((await ops(foreign, h.b))[0]).toMatchObject({
      state: "retry_wait",
      attempts: 1,
      version: foreignOp!.version,
    });
    // B's own job still sends it, with B's connection.
    await h.due(h.b);
    await h.drain(h.b);
    expect(messages()).toHaveLength(3);
    expect(messages()[2]!.authorization).toBe(`Bearer teams_${h.b}`);
  }, 20_000);

  it("keeps no outcome when the outcome transaction rolls back, and never resends", async () => {
    const id = await connect();
    // The health update is the last write of the outcome transaction.
    const drop = await failing(
      "quills.integrations",
      "UPDATE",
      "NEW.last_outbound_at IS DISTINCT FROM OLD.last_outbound_at",
    );
    try {
      await created(await makePost());
      await h.drain(h.a);
    } finally {
      await drop();
    }
    expect(messages()).toHaveLength(1);
    const [op] = await ops(id);
    expect(op).toMatchObject({ state: "running", remoteId: null });
    // The job comes back; the claim finds the operation running and records it as uncertain.
    await h.due(h.a);
    await h.drain(h.a);
    expect(messages()).toHaveLength(1);
    expect((await ops(id))[0]).toMatchObject({
      state: "uncertain",
      errorCode: "outcome_unknown",
    });
  }, 20_000);
});
