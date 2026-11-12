import { randomUUID } from "node:crypto";
import {
  afterAll,
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
import * as kaneo from "../../../database/schema";
import { boards } from "../../../database/quills/schema/boards";
import { postExternalLinks } from "../../../database/quills/schema/external-links";
import { integrationSyncOperations as operations } from "../../../database/quills/schema/integration-sync";
import {
  integrationPlatformCredentials,
  integrations,
} from "../../../database/quills/schema/integrations";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { posts } from "../../../database/quills/schema/posts";
import {
  decryptSecret,
  encryptSecret,
} from "../../../notification-preferences/secrets";
import type { BaseVariables } from "../../../openapi";
import router from "../..";
import { installationOf } from "../../integrations/catalog";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import "../../integrations/providers/azure-devops.fixture";
import { JIRA_CLOUD_ID } from "../../integrations/providers/jira.fixture";
import { LINEAR_ISSUE } from "../../integrations/providers/linear.fixture";
import { enqueueQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { fanOutIntegrations } from "./integration";

// Issue tracker deliveries (Jira, Linear, Azure DevOps) through the worker, against real PostgreSQL
// and the local provider server (integrations/provider-edge.fixture.ts). Each tracker runs the same
// evidence table: success, deduplication, lease loss, retries, uncertain outcomes, token refresh,
// reconnect states, fixed errors, workspace isolation and an outcome rollback.

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
const h = harness("tracker");
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
  "quills-integration-test-key";

/** Runs before each provider request, with its `METHOD /<host><path>`; it may wait. */
let beforeSend: ((route: string) => Promise<void> | void) | undefined;
const edge = vi.mocked(globalThis.fetch).getMockImplementation()!;
vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  await beforeSend?.(
    `${init?.method ?? "GET"} /${target.hostname}${target.pathname}`,
  );
  return edge(input, init);
});
/** Answers `route` with each value in turn, then with the server's own answer. */
const answers = (
  route: string,
  ...values: ({ status: number; body?: unknown } | "drop")[]
) => {
  beforeSend = (sent) => {
    if (sent !== route) return;
    const next = values.shift();
    if (next) providerOverrides.set(route, next);
    else providerOverrides.delete(route);
  };
};

type Tracker = {
  type: string;
  /** A valid channel; it is added through the channel route. */
  channel: string;
  config: Record<string, unknown>;
  /** The connection's secrets in a workspace. */
  secrets: (workspaceId: string) => Record<string, string>;
  /** The authorization header that the secrets send. */
  authorization: (workspaceId: string) => string;
  /** `METHOD /<host><path>` of the create call. */
  create: string;
  /** The token route, for a provider with refresh. */
  token?: string;
  /** The access token of the local server's refresh answer. */
  refreshedToken?: string;
  /** The link of the local server's create answer. */
  link: {
    externalId: string;
    externalUrl: string;
    externalDisplayId: string | null;
  };
  /** Checks the create request body. */
  request: (body: unknown, board: string) => void;
};

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const LINEAR_TEAM = "5b1f4c3e-0000-4000-8000-000000000001";
/** The board slug of the last post that makePost wrote. */
let lastBoard = "";
const CONTENT = "First line\n\n<script>alert(1)</script> & **bold**";

const trackers: Tracker[] = [
  {
    type: "jira",
    channel: "10000:10001",
    config: {
      cloudId: JIRA_CLOUD_ID,
      account: "https://contract.atlassian.net",
      scopes: "read:jira-work write:jira-work offline_access",
    },
    secrets: (workspaceId) => ({
      accessToken: `jira_${workspaceId}`,
      refreshToken: `jira_refresh_${workspaceId}`,
      expiresAt: future(),
    }),
    authorization: (workspaceId) => `Bearer jira_${workspaceId}`,
    create: `POST /api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}/rest/api/3/issue`,
    token: "POST /auth.atlassian.com/oauth/token",
    refreshedToken: "jira_contract_token",
    link: {
      externalId: "APP-1",
      externalUrl: "https://contract.atlassian.net/browse/APP-1",
      externalDisplayId: null,
    },
    request: (body, board) =>
      expect(body).toEqual({
        fields: {
          project: { id: "10000" },
          issuetype: { id: "10001" },
          summary: "Integration post",
          description: {
            version: 1,
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "First line" }],
              },
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "<script>alert(1)</script> & **bold**",
                  },
                ],
              },
              { type: "rule" },
              {
                type: "paragraph",
                content: [{ type: "text", text: `Submitted by: ${h.owner}` }],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: `Board: ${board}` }],
              },
            ],
          },
        },
      }),
  },
  {
    type: "linear",
    channel: LINEAR_TEAM,
    config: { scopes: "read issues:create" },
    secrets: (workspaceId) => ({
      accessToken: `linear_${workspaceId}`,
      refreshToken: `linear_refresh_${workspaceId}`,
      expiresAt: future(),
    }),
    authorization: (workspaceId) => `Bearer linear_${workspaceId}`,
    create: "POST /api.linear.app/graphql",
    token: "POST /api.linear.app/oauth/token",
    refreshedToken: "linear_contract_token",
    link: {
      externalId: LINEAR_ISSUE,
      externalUrl: "https://linear.app/contract/issue/ENG-1/integration-post",
      externalDisplayId: "ENG-1",
    },
    request: (body, board) =>
      expect(body).toEqual({
        query: expect.stringContaining("issueCreate(input: $input)"),
        variables: {
          input: {
            teamId: LINEAR_TEAM,
            title: "Integration post",
            // Markdown, as the post content is.
            description: `${CONTENT}\n\n---\n**Submitted by:** ${h.owner}\n**Board:** ${board}`,
          },
        },
      }),
  },
  {
    type: "azure_devops",
    // A project name with a space: the channel route and the target rule accept it.
    channel: "Contract App:Bug",
    config: { organization: "contract" },
    secrets: (workspaceId) => ({ accessToken: `pat_${workspaceId}` }),
    authorization: (workspaceId) =>
      `Basic ${Buffer.from(`:pat_${workspaceId}`).toString("base64")}`,
    create:
      "POST /dev.azure.com/contract/Contract%20App/_apis/wit/workitems/$Bug",
    link: {
      externalId: "42",
      // Built on the fixed host, not taken from the answer.
      externalUrl:
        "https://dev.azure.com/contract/Contract%20App/_workitems/edit/42",
      externalDisplayId: null,
    },
    request: (body, board) =>
      expect(body).toEqual([
        { op: "add", path: "/fields/System.Title", value: "Integration post" },
        {
          op: "add",
          path: "/fields/System.Description",
          // Escaped HTML: the post text is never markup.
          value: `<p>First line</p><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; **bold**</p><hr><p>Submitted by: ${h.owner}</p><p>Board: ${board}</p>`,
        },
      ]),
  },
];

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
/** A connection of the tracker, its OAuth app and its channel (through the channel route). */
async function connect(
  t: Tracker,
  workspaceId = h.a,
  config: Record<string, unknown> = t.config,
) {
  const id = await h.as(workspaceId, owner(workspaceId), async (db, actor) => {
    await db
      .delete(integrations)
      .where(eq(integrations.integrationType, t.type));
    await db
      .delete(integrationPlatformCredentials)
      .where(eq(integrationPlatformCredentials.integrationType, t.type));
    if (t.token)
      await db.insert(integrationPlatformCredentials).values({
        integrationType: t.type,
        secrets: seal({ clientId: "client", clientSecret: "app-secret" }),
      });
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: t.type,
        status: "active",
        secrets: seal(t.secrets(workspaceId)),
        config: { workspaceName: "Contract", account: null, ...config },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(Date.now() - 1000),
      })
      .returning({ id: integrations.id });
    return row!.id;
  });
  const res = await call(
    `/integrations/${id}/channels`,
    "POST",
    { channel: t.channel, events: ["post.created"] },
    workspaceId,
  );
  expect(res.status).toBe(200);
  return id;
}
async function makePost(workspaceId = h.a) {
  return h.as(workspaceId, owner(workspaceId), async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Board", slug: (lastBoard = `board-${randomUUID()}`) })
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
/** A trigger that fails `table`'s `event` when `condition` holds; dropped by the returned function. */
async function failing(table: string, event: string, condition: string) {
  const name = "fu_delivery_fail";
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

describe.skipIf(!url)("issue tracker delivery", () => {
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
    for (const workspaceId of [h.a, h.b])
      await h.system(workspaceId, (db) => db.delete(integrations));
  });

  describe.each(trackers)("$type", (t) => {
    const creates = () =>
      providerCalls.filter(
        (sent) => `${sent.method} ${sent.path.split("?")[0]}` === t.create,
      );

    it("creates one item, links it, and sends nothing new for a replayed job, fan-out or resync", async () => {
      const id = await connect(t);
      const postId = await makePost();
      const eventId = await created(postId);
      await h.drain(h.a);
      const [op] = await ops(id);
      expect(op).toMatchObject({
        state: "succeeded",
        attempts: 1,
        remoteId: t.link.externalId,
      });
      expect(creates()).toHaveLength(1);
      expect(creates()[0]!.authorization).toBe(t.authorization(h.a));
      t.request(JSON.parse(creates()[0]!.body), lastBoard);
      const [connection] = await h.system(h.a, (db) =>
        db
          .select({
            id: integrations.id,
            connectedAt: integrations.connectedAt,
          })
          .from(integrations)
          .where(eq(integrations.id, id)),
      );
      expect(await links(postId)).toEqual([
        expect.objectContaining({
          integrationId: id,
          integrationType: t.type,
          ...t.link,
          origin: "event",
          syncScope: `${installationOf(connection!)}:${t.channel}`,
        }),
      ]);
      expect(await syncItem(op!.id)).toMatchObject({
        state: "succeeded",
        remoteUrl: t.link.externalUrl,
        remoteDisplayId: t.link.externalDisplayId ?? t.link.externalId,
      });

      await replay((await job(op!.id)).id);
      await h.drain(h.a);
      await fanOutIntegrations(h.a, eventId);
      expect(
        (await call(`/posts/${postId}/integration-sync`, "POST")).status,
      ).toBe(200);
      await h.drain(h.a);
      expect(creates()).toHaveLength(1);
      expect(await ops(id)).toHaveLength(1);
      expect(await links(postId)).toHaveLength(1);
    }, 20_000);

    it("keeps the outcome when the job lease is lost during the send", async () => {
      const id = await connect(t);
      beforeSend = async (route) => {
        if (route !== t.create) return;
        await h.system(h.a, (db) =>
          db
            .update(jobQueue)
            .set({ lockedUntil: new Date(0) })
            .where(like(jobQueue.dedupeKey, "integration:%")),
        );
      };
      await created(await makePost());
      await h.drain(h.a);
      expect(creates()).toHaveLength(1);
      const [op] = await ops(id);
      expect(op).toMatchObject({ state: "succeeded", attempts: 1 });
      // The replacement found the recorded outcome and finished the job without a send.
      expect(await job(op!.id)).toMatchObject({
        status: "succeeded",
        attempts: 2,
      });
    }, 20_000);

    it("marks a send uncertain when a replacement worker takes the expired lease during it", async () => {
      const id = await connect(t);
      let replaced = false;
      beforeSend = async (route) => {
        if (route !== t.create || replaced) return;
        replaced = true;
        // The lease expires during the call, and a replacement worker runs the job meanwhile.
        await h.system(h.a, (db) =>
          db
            .update(jobQueue)
            .set({ lockedUntil: new Date(0) })
            .where(like(jobQueue.dedupeKey, "integration:%")),
        );
        await h.drain(h.a);
      };
      const postId = await makePost();
      await created(postId);
      await h.drain(h.a);
      expect(replaced).toBe(true);
      // The first worker's call reached the provider once; the replacement sent nothing.
      expect(creates()).toHaveLength(1);
      const [op] = await ops(id);
      expect(op).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
      expect(await links(postId)).toEqual([]);
      const item = await syncItem(op!.id);
      expect(item).toMatchObject({ state: "uncertain", actions: ["cancel"] });
    }, 20_000);

    it("retries a rate limit within the job's limits", async () => {
      const id = await connect(t);
      answers(t.create, { status: 429 });
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
      expect(creates()).toHaveLength(2);
    }, 20_000);

    // A personal access token (Azure DevOps) has no refresh: no such test, rather than a skipped one.
    if (t.token)
      it("retries a refresh that got a 5xx, with nothing sent, within the job's limits", async () => {
        const id = await connect(t);
        await h.system(h.a, (db) =>
          db
            .update(integrations)
            .set({
              secrets: seal({
                ...t.secrets(h.a),
                expiresAt: new Date(Date.now() - 1000).toISOString(),
              }),
            })
            .where(eq(integrations.id, id as never)),
        );
        answers(t.token!, { status: 503 });
        await created(await makePost());
        await h.drain(h.a);
        const [waiting] = await ops(id);
        expect(waiting).toMatchObject({
          state: "retry_wait",
          errorCode: "unavailable",
        });
        expect(creates()).toHaveLength(0);
        await h.due(h.a);
        await h.drain(h.a);
        expect((await ops(id))[0]).toMatchObject({ state: "succeeded" });
        expect(creates()).toHaveLength(1);
        expect(creates()[0]!.authorization).toBe(`Bearer ${t.refreshedToken}`);
        expect(await secretsOf(id)).toMatchObject({
          accessToken: t.refreshedToken,
        });
      }, 20_000);

    it("never resends a create that got no answer or a 5xx, and shows it for a teammate to check", async () => {
      const id = await connect(t);
      answers(t.create, "drop");
      await created(await makePost());
      await h.drain(h.a);
      expect(creates()).toHaveLength(1);
      const [op] = await ops(id);
      expect(op).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
      const failed = await job(op!.id);
      expect(failed).toMatchObject({ status: "failed", attempts: 1 });
      await replay(failed.id);
      await h.drain(h.a);
      expect(creates()).toHaveLength(1);
      const item = await syncItem(op!.id);
      expect(item).toMatchObject({ state: "uncertain", actions: ["cancel"] });
      expect(item.error).toContain("not sent again");
      expect(
        (
          await call(`/integration-syncs/${op!.id}/actions`, "POST", {
            action: "retry",
            version: item.version,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(409);

      answers(t.create, { status: 502 });
      await created(await makePost());
      await h.drain(h.a);
      expect(creates()).toHaveLength(2);
      expect((await ops(id))[1]).toMatchObject({ state: "uncertain" });
    }, 20_000);

    it("refreshes once after a 401, resends once and keeps the new tokens, or asks for a reconnect", async () => {
      const id = await connect(t);
      answers(t.create, { status: 401 });
      await created(await makePost());
      await h.drain(h.a);
      const [op] = await ops(id);
      if (!t.token) {
        // A personal access token has no refresh: one call, then a reconnect.
        expect(op).toMatchObject({
          state: "auth_required",
          errorCode: "authentication",
        });
        expect(creates()).toHaveLength(1);
        expect(await job(op!.id)).toMatchObject({
          status: "failed",
          attempts: 1,
        });
        return;
      }
      expect(op).toMatchObject({ state: "succeeded", attempts: 1 });
      expect(
        providerCalls.map(
          (sent) => `${sent.method} ${sent.path.split("?")[0]}`,
        ),
      ).toEqual([t.create, t.token, t.create]);
      expect(creates()[1]!.authorization).toBe(`Bearer ${t.refreshedToken}`);
      expect(await secretsOf(id)).toMatchObject({
        accessToken: t.refreshedToken,
      });

      // A second 401 after the refresh: a reconnect, with no third call.
      providerCalls.length = 0;
      answers(t.create, { status: 401 }, { status: 401 });
      await created(await makePost());
      await h.drain(h.a);
      expect((await ops(id))[1]).toMatchObject({
        state: "auth_required",
        errorCode: "authentication",
      });
      expect(creates()).toHaveLength(2);
    }, 20_000);

    it("asks for a reconnect on a 403, and without the write scopes sends nothing, with no retry", async () => {
      const id = await connect(t);
      answers(t.create, { status: 403 });
      await created(await makePost());
      await h.drain(h.a);
      const [refused] = await ops(id);
      expect(refused).toMatchObject({
        state: "auth_required",
        errorCode: "authentication",
      });
      expect(creates()).toHaveLength(1);
      expect(await job(refused!.id)).toMatchObject({
        status: "failed",
        attempts: 1,
      });
      if (!t.config.scopes) return;

      // A connection made with read scopes only (before delivery existed).
      providerCalls.length = 0;
      const readOnly = await connect(t, h.a, {
        ...t.config,
        scopes: undefined,
      });
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
    }, 20_000);

    it("maps a refused or malformed answer to a fixed error, never provider text", async () => {
      const id = await connect(t);
      answers(t.create, {
        status: 400,
        body: { errorMessages: ["secret provider text"] },
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

      // A 2xx without an ID: the item may exist, so it is uncertain and never sent again.
      answers(t.create, { status: 200, body: { unexpected: true } });
      await created(await makePost());
      await h.drain(h.a);
      expect((await ops(id))[1]).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
      expect(creates()).toHaveLength(2);
    }, 20_000);

    it("uses only the connection of the event's workspace", async () => {
      const own = await connect(t);
      const foreign = await connect(t, h.b);
      await created(await makePost());
      await h.drain(h.a);
      await h.drain(h.b);
      expect(creates()).toHaveLength(1);
      expect(creates()[0]!.authorization).toBe(t.authorization(h.a));
      expect(await ops(own)).toHaveLength(1);
      expect(await ops(foreign, h.b)).toHaveLength(0);
      // A job in A that names B's operation cannot read it.
      await created(await makePost(h.b), h.b);
      await h.drain(h.b);
      const [foreignOp] = await ops(foreign, h.b);
      expect(creates()[1]!.authorization).toBe(t.authorization(h.b));
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
      expect(creates()).toHaveLength(2);
    }, 20_000);

    it("leaves no link when the outcome transaction rolls back, and never resends", async () => {
      const id = await connect(t);
      const postId = await makePost();
      // The health update runs after the link insert in the outcome transaction.
      const drop = await failing(
        "quills.integrations",
        "UPDATE",
        "NEW.last_outbound_at IS DISTINCT FROM OLD.last_outbound_at",
      );
      try {
        await created(postId);
        await h.drain(h.a);
      } finally {
        await drop();
      }
      expect(creates()).toHaveLength(1);
      expect(await links(postId)).toEqual([]);
      const [op] = await ops(id);
      expect(op).toMatchObject({ state: "running", remoteId: null });
      // The job comes back; the claim finds the operation running and records it as uncertain.
      await h.due(h.a);
      await h.drain(h.a);
      expect(creates()).toHaveLength(1);
      expect(await links(postId)).toEqual([]);
      expect((await ops(id))[0]).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
    }, 20_000);
  });
});
