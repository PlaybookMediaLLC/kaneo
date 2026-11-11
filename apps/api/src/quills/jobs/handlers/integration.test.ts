import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import { boards } from "../../../database/quills/schema/boards";
import { events } from "../../../database/quills/schema/events";
import { postExternalLinks } from "../../../database/quills/schema/external-links";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { integrationSyncOperations as operations } from "../../../database/quills/schema/integration-sync";
import type { TypeId } from "@kaneo/ids";
import {
  integrationEventMappings,
  integrations,
} from "../../../database/quills/schema/integrations";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { encryptSecret } from "../../../notification-preferences/secrets";
import type { BaseVariables } from "../../../openapi";
import router from "../..";
import { recordQuillsChange } from "../../events";
import { enqueueQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { fanOutIntegrations } from "./integration";

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
const h = harness("integration");
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
  "quills-integration-test-key";

// The HTTP edge: a local receiver for webhook URLs and, through the fetch spy below, the Shortcut API.
type Hit = {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
};
type Respond = (req: IncomingMessage, res: ServerResponse) => unknown;
const ok: Respond = (_req, res) => res.writeHead(200).end();
let hits: Hit[] = [];
let respond: Respond = ok;
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    hits.push({
      method: req.method!,
      path: req.url!,
      headers: req.headers,
      body,
    });
    void respond(req, res);
  });
});
let base = "";
// The Shortcut API host goes to the local receiver; nothing else is redirected.
const realFetch = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  return target.hostname === "api.app.shortcut.com"
    ? realFetch(`${base}${target.pathname}`, init)
    : realFetch(input, init);
});
const json = (status: number, body: unknown) => (res: ServerResponse) =>
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(body));

const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("*", async (c, next) => {
  c.set("userId", c.req.header("x-user") ?? h.owner);
  c.set("user", null);
  await next();
});
app.route("/quills", router);
const call = (
  path: string,
  method = "GET",
  body?: unknown,
  workspaceId = h.a,
  user = workspaceId === h.a ? h.owner : h.outsider,
) =>
  app.request(`/quills/${workspaceId}${path}`, {
    method,
    headers: {
      "x-user": user,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const owner = (workspaceId: string) =>
  workspaceId === h.a ? h.owner : h.outsider;

/** Connects n8n through the route and maps the events to the connection. */
async function connectN8n(
  events: string[] = ["post.created"],
  workspaceId = h.a,
  hook = `${base}/hook`,
) {
  const res = await call(
    "/integrations/n8n/connection",
    "PUT",
    { webhookUrl: hook },
    workspaceId,
  );
  expect(res.status).toBe(200);
  const { integration } = await res.json();
  await map(integration.id, events, workspaceId);
  return integration.id as string;
}
async function map(id: string, events: string[], workspaceId = h.a) {
  const res = await call(
    `/integrations/${id}`,
    "PATCH",
    {
      eventMappings: events.map((eventType) => ({ eventType, enabled: true })),
    },
    workspaceId,
  );
  expect(res.status).toBe(200);
}
/** A connection row written without the route, as an older or edited row would be. */
const stored = (type: string, secrets: Record<string, string>) =>
  h.as(h.a, h.owner, async (db, actor) => {
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: type,
        status: "active",
        secrets: encryptSecret(JSON.stringify(secrets))!,
        config: {},
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(Date.now() - 1000),
      })
      .returning({ id: integrations.id });
    return row!.id;
  });
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
        content: "Feedback body",
        boardId: board!.id,
        principalId: actor.principalId,
      })
      .returning({ id: posts.id });
    return { postId: post!.id, boardId: board!.id };
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
const job = async (operationId: string, workspaceId = h.a) =>
  (
    await h.system(workspaceId, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(like(jobQueue.dedupeKey, `integration:${operationId}:%`))
        .orderBy(jobQueue.id),
    )
  ).at(-1);
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
const act = (
  syncId: string,
  action: string,
  version: number,
  key = randomUUID(),
) =>
  call(`/integration-syncs/${syncId}/actions`, "POST", {
    action,
    version,
    idempotencyKey: key,
  });

describe.skipIf(!url)("Quills integration delivery", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  }, 120000);
  afterAll(async () => {
    receiver.close();
    await h.stop();
    await pool?.end();
  });
  beforeEach(async () => {
    hits = [];
    respond = ok;
    // The receiver is on loopback; only the SSRF test turns this off.
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    for (const workspaceId of [h.a, h.b])
      await h.system(workspaceId, (db) => db.delete(integrations));
  });

  it("stores credentials sealed and never returns them", async () => {
    const res = await call("/integrations/ntfy/connection", "PUT", {
      url: `${base}/topic_secret`,
      token: "tk_secret_value",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const { integration } = JSON.parse(text);
    expect(integration).toMatchObject({
      integrationType: "ntfy",
      status: "active",
      account: "127.0.0.1",
    });
    for (const body of [
      text,
      await (await call("/integrations")).text(),
      await (await call(`/integrations/${integration.id}`)).text(),
      await (await call(`/integrations/${integration.id}/syncs`)).text(),
    ]) {
      expect(body).not.toContain("topic_secret");
      expect(body).not.toContain("tk_secret_value");
    }
    const [row] = await h.system(h.a, (db) =>
      db
        .select({ secrets: integrations.secrets, config: integrations.config })
        .from(integrations)
        .where(eq(integrations.id, integration.id)),
    );
    expect(row!.secrets).toMatch(/^enc:v1:/);
    expect(row!.secrets).not.toContain("tk_secret_value");
    expect(JSON.stringify(row!.config)).not.toContain("topic_secret");

    // The saved topic and token are the ones that deliver.
    await map(integration.id, ["post.created"]);
    const { postId } = await makePost();
    await created(postId);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ method: "POST", path: "/" });
    expect(hits[0]!.headers.authorization).toBe("Bearer tk_secret_value");
    expect(JSON.parse(hits[0]!.body)).toMatchObject({
      topic: "topic_secret",
      title: "New feedback: Integration post",
      message: "Feedback body",
    });
  });

  it("rejects private targets and foreign hosts when it saves and when it delivers", async () => {
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    for (const bad of [
      "https://127.0.0.1/hook",
      "https://169.254.169.254/latest",
      "https://10.1.2.3/hook",
      "https://[::1]/hook",
      "https://localhost/hook",
      "https://user:pass@203.0.113.10/hook",
    ])
      expect(
        (await call("/integrations/n8n/connection", "PUT", { webhookUrl: bad }))
          .status,
      ).toBe(400);
    for (const [type, webhookUrl] of [
      ["make", "https://evil.example.com/make.com"],
      ["make", "http://hook.eu1.make.com/x"],
      ["zapier", "https://hooks.zapier.com.evil.test/x"],
    ])
      expect(
        (await call(`/integrations/${type}/connection`, "PUT", { webhookUrl }))
          .status,
      ).toBe(400);
    expect(
      (
        await call("/integrations/ntfy/connection", "PUT", {
          url: "https://203.0.113.10/a/b",
        })
      ).status,
    ).toBe(400);
    for (const url of ["https://127.0.0.1/topic", "https://10.0.0.5/topic"])
      expect(
        (await call("/integrations/ntfy/connection", "PUT", { url })).status,
      ).toBe(400);
    expect(await h.system(h.a, (db) => db.select().from(integrations))).toEqual(
      [],
    );
    // A row that bypassed the route, or whose host now resolves privately, is refused at delivery.
    const n8n = await stored("n8n", { url: "https://127.0.0.1/hook" });
    await map(n8n, ["post.created"]);
    await created((await makePost()).postId);
    await h.drain(h.a);
    expect((await ops(n8n))[0]).toMatchObject({
      state: "failed",
      errorCode: "destination_rejected",
    });
    // The provider host allowlist holds even when private destinations are allowed.
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    expect((await call(`/integrations/${n8n}`, "DELETE")).status).toBe(200);
    // An HTTPS URL on a public address that is not a Make host: only the host check refuses it.
    const make = await stored("make", { url: "https://203.0.113.10/hook" });
    await map(make, ["post.created"]);
    await created((await makePost()).postId);
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect((await ops(make))[0]).toMatchObject({
      state: "failed",
      errorCode: "destination_rejected",
    });
    expect(
      (await (await call(`/integrations/${make}`)).json()).integration,
    ).toMatchObject({
      lastError: "The destination is not a public address.",
      errorCount: 1,
    });
  });

  it("delivers once per operation, also when the job, the fan-out or a resync repeats", async () => {
    const id = await connectN8n();
    const { postId } = await makePost();
    const eventId = await created(postId);
    await h.drain(h.a);
    const [op] = await ops(id);
    expect(op).toMatchObject({
      state: "succeeded",
      attempts: 1,
      kind: "create",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.headers["x-kaneo-delivery"]).toBe(op!.id);
    expect(JSON.parse(hits[0]!.body)).toMatchObject({
      event: "post.created",
      post: { id: postId, title: "Integration post", content: "Feedback body" },
    });

    await replay((await job(op!.id))!.id);
    await h.drain(h.a);
    await fanOutIntegrations(h.a, eventId);
    expect(
      (await call(`/posts/${postId}/integration-sync`, "POST")).status,
    ).toBe(200);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect(await ops(id)).toHaveLength(1);
  });

  it("records an uncertain outcome and never sends it again, not even on a teammate's retry", async () => {
    respond = (req) => req.socket.destroy();
    const id = await connectN8n();
    const { postId } = await makePost();
    await created(postId);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    const [op] = await ops(id);
    expect(op).toMatchObject({
      state: "uncertain",
      errorCode: "outcome_unknown",
    });
    const failed = (await job(op!.id))!;
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.lastError).toContain("uncertain");

    respond = ok;
    await replay(failed.id);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);

    const { item } = await (await call(`/integration-syncs/${op!.id}`)).json();
    expect(item).toMatchObject({ state: "uncertain", actions: ["cancel"] });
    expect(item.error).toContain("not sent again");
    expect((await act(op!.id, "retry", item.version)).status).toBe(409);
    const cancelled = await act(op!.id, "cancel", item.version);
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).item).toMatchObject({
      state: "uncertain",
      cancelRequested: true,
      actions: [],
    });
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
  });

  it("treats an operation that is still running as uncertain", async () => {
    const id = await connectN8n();
    const { postId } = await makePost();
    const eventId = await created(postId);
    await fanOutIntegrations(h.a, eventId);
    // A worker claimed the operation, then stopped before it recorded the outcome.
    await h.system(h.a, (db) =>
      db
        .update(operations)
        .set({
          state: "running",
          leaseToken: randomUUID(),
          dispatchedAt: new Date(),
          attempts: 1,
        })
        .where(eq(operations.integrationId, id)),
    );
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    const [op] = await ops(id);
    expect(op).toMatchObject({
      state: "uncertain",
      errorCode: "outcome_unknown",
    });
    expect((await job(op!.id))!).toMatchObject({ status: "failed" });
  });

  it("keeps a delivered outcome when the job lease expires during the send", async () => {
    respond = async (_req, res) => {
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({ lockedUntil: new Date(0) })
          .where(like(jobQueue.dedupeKey, "integration:%")),
      );
      res.writeHead(204).end();
    };
    const id = await connectN8n();
    await created((await makePost()).postId);
    // The first attempt cannot finish its job; the replacement finds the outcome and sends nothing.
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    const [op] = await ops(id);
    expect(op).toMatchObject({ state: "succeeded", attempts: 1 });
    expect((await job(op!.id))!).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
  });

  it("shows an operation stopped on the job's last attempt as uncertain, and lets a teammate close it", async () => {
    const id = await connectN8n();
    const eventId = await created((await makePost()).postId);
    await fanOutIntegrations(h.a, eventId);
    // The last attempt claimed it and stopped; the lease reaper then failed the job, so no job returns.
    await h.system(h.a, async (db) => {
      await db
        .update(operations)
        .set({
          state: "running",
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() - 1000),
          dispatchedAt: new Date(),
        })
        .where(eq(operations.integrationId, id));
      await db
        .update(jobQueue)
        .set({ status: "failed", attempts: 5, finishedAt: new Date() })
        .where(like(jobQueue.dedupeKey, "integration:%"));
    });
    const [op] = await ops(id);
    const { item } = await (await call(`/integration-syncs/${op!.id}`)).json();
    expect(item).toMatchObject({ state: "uncertain", actions: ["cancel"] });
    expect((await act(op!.id, "retry", item.version)).status).toBe(409);
    const closed = await act(op!.id, "cancel", item.version);
    expect((await closed.json()).item).toMatchObject({
      state: "uncertain",
      cancelRequested: true,
      actions: [],
    });
    expect((await ops(id))[0]).toMatchObject({
      state: "uncertain",
      leaseToken: null,
    });
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
  });

  it("retries an unavailable receiver, fails a rejection, and retries a failure on request", async () => {
    respond = (_req, res) => res.writeHead(503).end();
    const id = await connectN8n();
    const first = await makePost();
    await created(first.postId);
    await h.drain(h.a);
    const [waiting] = await ops(id);
    expect(waiting).toMatchObject({
      state: "retry_wait",
      errorCode: "unavailable",
    });
    const pending = (await job(waiting!.id))!;
    expect(pending).toMatchObject({ status: "pending", attempts: 1 });
    expect(pending.runAt.getTime()).toBeGreaterThan(Date.now());
    respond = ok;
    await h.due(h.a);
    await h.drain(h.a);
    expect((await ops(id))[0]).toMatchObject({
      state: "succeeded",
      attempts: 2,
    });

    respond = (_req, res) =>
      res.writeHead(400).end("provider says secret things");
    const second = await makePost();
    await created(second.postId);
    await h.drain(h.a);
    const failed = (await ops(id))[1]!;
    expect(failed).toMatchObject({
      state: "failed",
      errorCode: "provider_failed",
    });
    expect((await job(failed.id))!).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    const detail = await (await call(`/integration-syncs/${failed.id}`)).text();
    expect(detail).not.toContain("secret things");

    respond = ok;
    // A stale version is refused and changes nothing.
    expect((await act(failed.id, "retry", failed.version - 1)).status).toBe(
      409,
    );
    const key = randomUUID();
    const retried = await act(failed.id, "retry", failed.version, key);
    expect(retried.status).toBe(200);
    expect((await retried.json()).item).toMatchObject({ state: "queued" });
    const recorded = async () =>
      (
        await h.system(h.a, (db) =>
          db
            .select()
            .from(events)
            .where(eq(events.type, "integration_sync.recovered")),
        )
      ).filter((event) => event.entityId === failed.id).length;
    expect(await recorded()).toBe(1);
    // The same key again changes nothing and records nothing; the same key for another action is refused.
    const again = await act(failed.id, "retry", failed.version, key);
    expect(again.status).toBe(200);
    expect((await again.json()).replayed).toBe(true);
    expect(await recorded()).toBe(1);
    expect(
      (await act(failed.id, "cancel", failed.version + 1, key)).status,
    ).toBe(409);
    // The worker starts the retry only after the request committed.
    expect(hits).toHaveLength(3);
    await h.drain(h.a);
    expect(hits).toHaveLength(4);
    expect((await ops(id))[1]).toMatchObject({
      state: "succeeded",
      attempts: 2,
    });
  });

  it("fails a delivery that is still unavailable on the job's last attempt", async () => {
    respond = (_req, res) => res.writeHead(429).end();
    const id = await connectN8n();
    await created((await makePost()).postId);
    await h.drain(h.a);
    for (let attempt = 2; attempt <= 5; attempt++) {
      expect((await ops(id))[0]).toMatchObject({ state: "retry_wait" });
      await h.due(h.a);
      await h.drain(h.a);
    }
    expect(hits).toHaveLength(5);
    const [op] = await ops(id);
    expect(op).toMatchObject({
      state: "failed",
      errorCode: "unavailable",
      attempts: 5,
    });
    expect((await job(op!.id))!).toMatchObject({
      status: "failed",
      attempts: 5,
    });
    // A teammate can retry it: nothing was delivered.
    const { item } = await (await call(`/integration-syncs/${op!.id}`)).json();
    expect(item.actions).toEqual(["retry", "cancel"]);
  });

  it("delivers only inside the event's workspace", async () => {
    const own = await connectN8n();
    const foreign = await connectN8n(["post.created"], h.b);
    const { postId } = await makePost();
    await created(postId);
    await h.drain(h.a);
    await h.drain(h.b);
    expect(hits).toHaveLength(1);
    expect(await ops(own)).toHaveLength(1);
    expect(await ops(foreign, h.b)).toHaveLength(0);
    // A job in A that names B's operation cannot read it.
    const other = await makePost(h.b);
    await created(other.postId, h.b);
    await h.drain(h.b);
    const [foreignOp] = await ops(foreign, h.b);
    expect(hits).toHaveLength(2);
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
    expect(hits).toHaveLength(2);
    // Sync routes in A do not show B's operation.
    expect((await call(`/integration-syncs/${foreignOp!.id}`)).status).toBe(
      404,
    );
    expect((await call(`/integrations/${foreign}/syncs`)).status).toBe(404);
  });

  it("sends nothing for a rolled-back mutation", async () => {
    const id = await connectN8n();
    const { postId } = await makePost();
    await expect(
      h.as(h.a, h.owner, async (db, actor) => {
        await recordQuillsChange(db, actor, {
          type: "post.created",
          entityType: "post",
          entityId: postId,
        });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect(await ops(id)).toHaveLength(0);
  });

  it("skips private comments, other boards, backlog and paused connections", async () => {
    const id = await connectN8n(["post.created", "comment.created"]);
    const wanted = await makePost();
    const other = await makePost();
    // A board filter on the connection's mappings: only the wanted board.
    await h.system(h.a, (db) =>
      db
        .update(integrationEventMappings)
        .set({ filters: { boardIds: [wanted.boardId] } })
        .where(
          eq(
            integrationEventMappings.integrationId,
            id as TypeId<"integration">,
          ),
        ),
    );
    const comment = (isPrivate: boolean) =>
      h.as(h.a, h.owner, async (db, actor) => {
        const [row] = await db
          .insert(postComments)
          .values({
            postId: wanted.postId,
            principalId: actor.principalId,
            content: "A comment",
            isPrivate,
          })
          .returning({ id: postComments.id });
        return row!.id;
      });
    const publicComment = await comment(false);
    const privateComment = await comment(true);
    await h.emit(h.a, {
      type: "post.created",
      entityType: "post",
      entityId: wanted.postId,
      deliver: false,
    });
    await created(other.postId);
    for (const commentId of [privateComment, publicComment])
      await h.emit(h.a, {
        type: "comment.created",
        entityType: "comment",
        entityId: commentId,
      });
    await h.drain(h.a);
    expect(hits.map((hit) => JSON.parse(hit.body).event)).toEqual([
      "comment.created",
    ]);
    expect(JSON.parse(hits[0]!.body).comment).toMatchObject({
      id: publicComment,
      content: "A comment",
    });

    // A paused connection hears nothing.
    expect(
      (await call(`/integrations/${id}`, "PATCH", { enabled: false })).status,
    ).toBe(200);
    await created(wanted.postId);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
  });

  it("creates a Shortcut story, links it to the post and maps provider errors", async () => {
    respond = (req, res) =>
      req.url === "/api/v3/member"
        ? json(401, { message: "provider detail" })(res)
        : res.writeHead(500).end();
    const rejected = await call("/integrations/shortcut/connection", "PUT", {
      apiToken: "sc_bad",
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).not.toContain("provider detail");

    respond = (req, res) =>
      req.url === "/api/v3/member"
        ? json(200, { workspace2: { name: "Acme", url_slug: "acme" } })(res)
        : json(201, {
            id: 42,
            app_url: "https://app.shortcut.com/acme/story/42",
          })(res);
    const saved = await call("/integrations/shortcut/connection", "PUT", {
      apiToken: "sc_good",
    });
    expect(saved.status).toBe(200);
    const { integration } = await saved.json();
    expect(integration).toMatchObject({
      workspaceName: "Acme",
      account: "acme",
    });
    const added = await call(
      `/integrations/${integration.id}/channels`,
      "POST",
      {
        channel: "group-1",
        events: ["post.created"],
      },
    );
    expect(added.status).toBe(200);
    expect(
      (
        await call(`/integrations/${integration.id}/channels`, "POST", {
          channel: "group-2",
          events: ["comment.created"],
        })
      ).status,
    ).toBe(400);
    const { postId } = await makePost();
    await created(postId);
    hits = [];
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ method: "POST", path: "/api/v3/stories" });
    expect(hits[0]!.headers["shortcut-token"]).toBe("sc_good");
    expect(JSON.parse(hits[0]!.body)).toMatchObject({
      name: "Integration post",
      group_id: "group-1",
      story_type: "feature",
    });
    const [op] = await ops(integration.id);
    expect(op).toMatchObject({ state: "succeeded", remoteId: "42" });
    const { links } = await (
      await call(`/posts/${postId}/external-links`)
    ).json();
    expect(links).toEqual([
      expect.objectContaining({
        integrationType: "shortcut",
        externalId: "42",
        externalUrl: "https://app.shortcut.com/acme/story/42",
        origin: "event",
      }),
    ]);

    // A server error after a create may have made the story: uncertain, never sent again.
    respond = (_req, res) => res.writeHead(502).end();
    const next = await makePost();
    await created(next.postId);
    hits = [];
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await ops(integration.id))[1]).toMatchObject({
      state: "uncertain",
    });
  });

  it("resumes a create that waited for moderation when a resync is requested", async () => {
    const id = await connectN8n();
    const { postId } = await makePost();
    const moderation = (state: "pending" | "published") =>
      h.system(h.a, (db) =>
        db
          .update(posts)
          .set({ moderationState: state })
          .where(eq(posts.id, postId)),
      );
    await moderation("pending");
    await created(postId);
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect((await ops(id))[0]).toMatchObject({
      state: "cancelled",
      errorCode: "source_unavailable",
    });
    expect(
      (await call(`/posts/${postId}/integration-sync`, "POST")).status,
    ).toBe(409);
    await moderation("published");
    expect(
      (await call(`/posts/${postId}/integration-sync`, "POST")).status,
    ).toBe(200);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect(await ops(id)).toEqual([
      expect.objectContaining({ state: "succeeded", attempts: 1 }),
    ]);
  });

  it("hides the post of a sync on a board the caller cannot see", async () => {
    respond = (_req, res) => res.writeHead(400).end();
    const id = await connectN8n();
    const { postId, boardId } = await makePost();
    await created(postId);
    await h.drain(h.a);
    const [op] = await ops(id);
    // The board is linked to a project that the member cannot open.
    const projectId = `${h.a}_private`;
    await h.db().insert(kaneo.projectTable).values({
      id: projectId,
      workspaceId: h.a,
      name: "Private",
      slug: projectId,
    });
    await h.db().insert(kaneo.workspaceMemberAccessTable).values({
      workspaceId: h.a,
      userId: h.mate,
      projectAccess: "selected",
    });
    await h.system(h.a, (db) =>
      db.insert(boardProjects).values({ boardId, projectId }),
    );
    const asMate = (path: string) => call(path, "GET", undefined, h.a, h.mate);
    const list = await (await asMate(`/integrations/${id}/syncs`)).json();
    expect(list.items).toEqual([
      expect.objectContaining({ id: op!.id, post: null, actions: [] }),
    ]);
    expect(JSON.stringify(list)).not.toContain(postId);
    expect((await asMate(`/integration-syncs/${op!.id}`)).status).toBe(404);
    expect((await asMate(`/posts/${postId}/external-links`)).status).toBe(404);
    // The owner, who can open every project, sees it and its actions.
    const { item } = await (await call(`/integration-syncs/${op!.id}`)).json();
    expect(item).toMatchObject({
      post: { id: postId },
      actions: ["retry", "cancel"],
    });
  });

  it("cancels a queued delivery whose connection was replaced", async () => {
    const id = await connectN8n();
    const { postId } = await makePost();
    await created(postId);
    // Fan out without running the delivery, then reconnect: a new installation.
    const claimed = await h.system(h.a, (db) =>
      db
        .select({ eventId: jobQueue.dedupeKey })
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.queue, "quills.event"),
            eq(jobQueue.status, "pending"),
          ),
        ),
    );
    for (const { eventId } of claimed) await fanOutIntegrations(h.a, eventId!);
    await connectN8n();
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect((await ops(id))[0]).toMatchObject({
      state: "cancelled",
      errorCode: "installation_changed",
    });
  });

  it("checks the live connection again at claim time, and a resync resumes the cancelled create", async () => {
    const id = await connectN8n(["post.created", "post.status_changed"]);
    const { postId } = await makePost();
    const queue = async (type: "post.created" | "post.status_changed") =>
      fanOutIntegrations(
        h.a,
        await h.emit(h.a, { type, entityType: "post", entityId: postId }),
      );
    // Queued, then the event type is turned off before the worker claims it.
    await queue("post.status_changed");
    await call(`/integrations/${id}`, "PATCH", {
      eventMappings: [{ eventType: "post.status_changed", enabled: false }],
    });
    await h.drain(h.a);
    // Queued, then the connection is paused before the worker claims it.
    await queue("post.created");
    expect(
      (await call(`/integrations/${id}`, "PATCH", { enabled: false })).status,
    ).toBe(200);
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect(
      (await ops(id)).map((op) => [op.kind, op.state, op.errorCode]),
    ).toEqual([
      ["notify", "cancelled", "installation_changed"],
      ["create", "cancelled", "installation_changed"],
    ]);
    await call(`/integrations/${id}`, "PATCH", { enabled: true });
    expect(
      (await call(`/posts/${postId}/integration-sync`, "POST")).status,
    ).toBe(200);
    await h.drain(h.a);
    expect(hits.map((hit) => JSON.parse(hit.body).event)).toEqual([
      "post.created",
    ]);
    expect((await ops(id))[1]).toMatchObject({ state: "succeeded" });
  });

  it("delivers a status change without its event row and stops when the post is deleted", async () => {
    const id = await connectN8n(["post.status_changed"]);
    const { postId } = await makePost();
    const [statusId] = await h.system(h.a, (db) =>
      db
        .select({ id: postStatuses.id, name: postStatuses.name })
        .from(postStatuses)
        .limit(1),
    );
    const change = () =>
      h.emit(h.a, {
        type: "post.status_changed",
        entityType: "post",
        entityId: postId,
        payload: { statusId: statusId!.id },
      });
    // Retention removed the event before the worker ran: the operation has what it needs.
    const first = await change();
    await fanOutIntegrations(h.a, first);
    await h.system(h.a, (db) =>
      db.delete(events).where(eq(events.eventId, first)),
    );
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect(JSON.parse(hits[0]!.body)).toMatchObject({
      event: "post.status_changed",
      status_change: { new: statusId!.name },
    });
    // The shared purge trigger cancels a queued delivery of a post that is then deleted.
    await fanOutIntegrations(h.a, await change());
    await h.system(h.a, (db) =>
      db
        .update(posts)
        .set({ deletedAt: new Date() })
        .where(eq(posts.id, postId)),
    );
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await ops(id))[1]).toMatchObject({
      state: "cancelled",
      errorCode: "source_unavailable",
      cancelRequested: true,
    });
  });

  it("does not send a comment on a post that waits for moderation", async () => {
    const id = await connectN8n(["comment.created"]);
    const { postId } = await makePost();
    const commentId = await h.as(h.a, h.owner, async (db, actor) => {
      await db
        .update(posts)
        .set({ moderationState: "pending" })
        .where(eq(posts.id, postId));
      const [row] = await db
        .insert(postComments)
        .values({ postId, principalId: actor.principalId, content: "Hidden" })
        .returning({ id: postComments.id });
      return row!.id;
    });
    await h.emit(h.a, {
      type: "comment.created",
      entityType: "comment",
      entityId: commentId,
    });
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect((await ops(id))[0]).toMatchObject({
      state: "cancelled",
      errorCode: "source_unavailable",
    });
  });

  it("offers a retry of an auth failure only on the connection it was made for", async () => {
    respond = (_req, res) => res.writeHead(401).end();
    const id = await connectN8n();
    await created((await makePost()).postId);
    await h.drain(h.a);
    const [rejected] = await ops(id);
    expect(rejected).toMatchObject({
      state: "auth_required",
      errorCode: "authentication",
    });
    // Unreadable credentials are an auth failure too, and nothing is sent.
    await h.system(h.a, (db) =>
      db
        .update(integrations)
        .set({ secrets: "enc:v1:broken" })
        .where(eq(integrations.id, id as TypeId<"integration">)),
    );
    await created((await makePost()).postId);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await ops(id))[1]).toMatchObject({
      state: "auth_required",
      errorCode: "credentials_unavailable",
    });
    const actions = async () =>
      (await (await call(`/integration-syncs/${rejected!.id}`)).json()).item;
    expect((await actions()).actions).toEqual(["retry", "cancel"]);
    // A reconnect starts a new installation: the old operation can be closed, not retried.
    await connectN8n();
    const item = await actions();
    expect(item.actions).toEqual(["cancel"]);
    expect((await act(rejected!.id, "retry", item.version)).status).toBe(409);
  });

  it("keeps the story ID when the connection is deleted during a Shortcut create", async () => {
    respond = (_req, res) =>
      json(200, { workspace2: { name: "Acme", url_slug: "acme" } })(res);
    const saved = await call("/integrations/shortcut/connection", "PUT", {
      apiToken: "sc_good",
    });
    const { integration } = await saved.json();
    await map(integration.id, ["post.created"]);
    const { postId } = await makePost();
    await created(postId);
    respond = async (_req, res) => {
      await h.system(h.a, (db) =>
        db.delete(integrations).where(eq(integrations.id, integration.id)),
      );
      json(201, { id: 7, app_url: "https://app.shortcut.com/acme/story/7" })(
        res,
      );
    };
    hits = [];
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await ops(integration.id))[0]).toMatchObject({
      state: "succeeded",
      remoteId: "7",
    });
    const links = await h.system(h.a, (db) =>
      db
        .select()
        .from(postExternalLinks)
        .where(eq(postExternalLinks.postId, postId)),
    );
    expect(links).toEqual([]);
  });

  it("refuses a credential with invisible characters before any call", async () => {
    for (const [type, body] of [
      ["freshdesk", { apiKey: "key​", subdomain: "acme" }],
      ["shortcut", { apiToken: "tok€" }],
      ["ntfy", { url: `${base}/topic`, token: "tok en" }],
    ] as const)
      expect(
        (await call(`/integrations/${type}/connection`, "PUT", body)).status,
      ).toBe(400);
    expect(hits).toHaveLength(0);
  });

  it("pages and filters the sync history", async () => {
    respond = (_req, res) => res.writeHead(hits.length % 2 ? 400 : 200).end();
    const id = await connectN8n();
    for (let i = 0; i < 4; i++) await created((await makePost()).postId);
    await h.drain(h.a);
    const page = async (query: string) =>
      (await call(`/integrations/${id}/syncs?${query}`)).json();
    const first = await page("limit=3");
    expect(first.items).toHaveLength(3);
    const second = await page(`limit=3&cursor=${first.nextCursor}`);
    expect(second).toMatchObject({ nextCursor: null });
    expect(second.items).toHaveLength(1);
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((item: { id: string }) => item.id)).size).toBe(4);
    const created_ = all.map((item: { createdAt: string }) => item.createdAt);
    expect([...created_].sort().reverse()).toEqual(created_);
    const states = async (filter: string) =>
      (await page(`filter=${filter}`)).items.map(
        (item: { state: string }) => item.state,
      );
    expect(await states("successful")).toEqual(["succeeded", "succeeded"]);
    expect(await states("attention")).toEqual(["failed", "failed"]);
    expect(await states("progress")).toEqual([]);
  });
});
