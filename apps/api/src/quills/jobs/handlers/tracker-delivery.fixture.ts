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
import { enqueueQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { fanOutIntegrations } from "./integration";

// The worker evidence for a provider whose `deliver` creates an item (an issue, task or work item),
// through the worker, against real PostgreSQL and the local provider server
// (integrations/provider-edge.fixture.ts): success and link, deduplication, lease loss, retries,
// uncertain outcomes, token refresh, reconnect states, fixed errors, workspace isolation and an
// outcome rollback. A test file mocks ../../../database/index with the pool that describeDelivery
// hands it, and ../../../ws, then calls describeDelivery once (see tracker-delivery.test.ts).

let pool: Pool;
const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("delivery");
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
  "quills-integration-test-key";

/** Runs before each provider request, with its `METHOD /<host><path>`; it may wait. */
let beforeSend: ((route: string) => Promise<void> | void) | undefined;
/** The content type and query of each provider request, in order (the edge records neither). */
const sent: { route: string; contentType: string; search: string }[] = [];
const edge = vi.mocked(globalThis.fetch).getMockImplementation()!;
vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  const route = `${init?.method ?? "GET"} /${target.hostname}${target.pathname}`;
  sent.push({
    route,
    contentType: new Headers(init?.headers).get("content-type") ?? "",
    search: target.search,
  });
  await beforeSend?.(route);
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

/** One provider in the evidence table. */
export type DeliveryCase = {
  type: string;
  /** A valid channel; it is added through the channel route. */
  channel: string;
  /** A second valid channel of the same connection. */
  otherChannel: string;
  config: Record<string, unknown>;
  /** The connection's secrets in a workspace. */
  secrets: (workspaceId: string) => Record<string, string>;
  /** The authorization header that the secrets send. */
  authorization: (workspaceId: string) => string;
  /** `METHOD /<host><path>` of the create call, its content type and its query (`?…` or ""). */
  create: string;
  contentType: string;
  query: string;
  /** The token route, for a provider with refresh. */
  token?: string;
  /** The workspace's OAuth app, for a provider whose delivery reads it without a token route. */
  app?: (workspaceId: string) => Record<string, string>;
  /** The access and refresh tokens of the local server's refresh answer. */
  refreshedToken?: string;
  refreshedRefreshToken?: string;
  /** The link of the local server's create answer. */
  link: {
    externalId: string;
    externalUrl: string;
    externalDisplayId: string | null;
  };
  /** Checks the create request body for a post on `board` by `author`, with CONTENT. */
  request: (body: unknown, post: { board: string; author: string }) => void;
};

/** An expiry an hour from now, for secrets with a token that is not due. */
export const future = () => new Date(Date.now() + 3_600_000).toISOString();
/** The content of every post: two paragraphs, markup and Markdown that a provider must not run. */
export const CONTENT = "First line\n\n<script>alert(1)</script> & **bold**";
/** The board slug of the last post that makePost wrote. */
let lastBoard = "";

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
  t: DeliveryCase,
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
    if (t.token || t.app)
      await db.insert(integrationPlatformCredentials).values({
        integrationType: t.type,
        secrets: seal(
          t.app?.(workspaceId) ?? {
            clientId: "client",
            clientSecret: "app-secret",
          },
        ),
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

/**
 * Registers the evidence table for each case. `usePool` gets the test pool before any query: the
 * caller's database mock must return it. Call it once per test file.
 */
export const describeDelivery = (
  cases: DeliveryCase[],
  usePool: (pool: Pool) => void,
) =>
  describe.skipIf(!url)("issue tracker delivery", () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 8 });
      usePool(pool);
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

    describe.each(cases)("$type", (t) => {
      const creates = () =>
        providerCalls.filter(
          (sent) => `${sent.method} ${sent.path.split("?")[0]}` === t.create,
        );
      /** The refresh sent the workspace's OAuth app and the stored refresh token; all new token fields are stored. */
      const refreshedWithApp = async (id: string) => {
        const refresh = providerCalls.find(
          (sent) => `${sent.method} ${sent.path.split("?")[0]}` === t.token,
        )!;
        expect(refresh.body).toContain("app-secret");
        expect(refresh.body).toContain(t.secrets(h.a).refreshToken!);
        const stored = await secretsOf(id);
        expect(stored).toMatchObject({
          accessToken: t.refreshedToken,
          refreshToken: t.refreshedRefreshToken,
        });
        expect(Date.parse(stored.expiresAt!)).toBeGreaterThan(
          Date.now() + 30 * 60_000,
        );
      };

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
        expect(sent.find((request) => request.route === t.create)).toEqual({
          route: t.create,
          contentType: t.contentType,
          search: t.query,
        });
        t.request(JSON.parse(creates()[0]!.body), {
          board: lastBoard,
          author: h.owner,
        });
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

      it("after a reconnect, a resync sends no create that was sent or may have been, and fills a new channel", async () => {
        const id = await connect(t);
        const sentPost = await makePost();
        await created(sentPost);
        await h.drain(h.a);
        // A second post whose create got no answer: uncertain, with no link.
        answers(t.create, "drop");
        const unsurePost = await makePost();
        await created(unsurePost);
        await h.drain(h.a);
        expect((await ops(id)).map((op) => op.state)).toEqual([
          "succeeded",
          "uncertain",
        ]);
        // A reconnect starts a new installation; channels, links and operations stay. Then a second
        // channel is added.
        await h.system(h.a, (db) =>
          db
            .update(integrations)
            .set({ connectedAt: new Date() })
            .where(eq(integrations.id, id)),
        );
        expect(
          (
            await call(`/integrations/${id}/channels`, "POST", {
              channel: t.otherChannel,
              events: ["post.created"],
            })
          ).status,
        ).toBe(200);
        const before = providerCalls.length;
        for (const postId of [sentPost, unsurePost])
          expect(
            (await call(`/posts/${postId}/integration-sync`, "POST")).status,
          ).toBe(200);
        await h.drain(h.a);
        // Only the new channel gets a create for each post; the first channel gets nothing again.
        const resynced = (await ops(id)).slice(2);
        expect(resynced.map((op) => op.destinationKey)).toEqual([
          t.otherChannel,
          t.otherChannel,
        ]);
        expect(providerCalls.length - before).toBe(2);
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
      for (const status of t.token ? [503, 429, 408] : [])
        it(`retries a refresh that got a ${status}, with nothing sent, within the job's limits`, async () => {
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
          answers(t.token!, { status });
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
          expect(creates()[0]!.authorization).toBe(
            `Bearer ${t.refreshedToken}`,
          );
          await refreshedWithApp(id);
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
        await refreshedWithApp(id);

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
        // A job in A that names B's operation cannot read it, while B's operation waits to be sent.
        answers(t.create, { status: 429 });
        await created(await makePost(h.b), h.b);
        await h.drain(h.b);
        const [foreignOp] = await ops(foreign, h.b);
        expect(foreignOp).toMatchObject({ state: "retry_wait", attempts: 1 });
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
        expect((await ops(foreign, h.b))[0]).toMatchObject({
          state: "retry_wait",
          attempts: 1,
          version: foreignOp!.version,
        });
        // B's own job still sends it, with B's connection.
        await h.due(h.b);
        await h.drain(h.b);
        expect(creates()).toHaveLength(3);
        expect(creates()[2]!.authorization).toBe(t.authorization(h.b));
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
