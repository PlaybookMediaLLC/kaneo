import { createHmac } from "node:crypto";
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
import { eq, like } from "drizzle-orm";
import { createId } from "@kaneo/ids";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import { auditLog } from "../../../database/quills/schema/audit-log";
import { boards } from "../../../database/quills/schema/boards";
import { events } from "../../../database/quills/schema/events";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { webhooks } from "../../../database/quills/schema/webhooks";
import { encryptSecret } from "../../../notification-preferences/secrets";
import type { BaseVariables } from "../../../openapi";
import router from "../..";
import { RECEIPT_MAX_BYTES, recordQuillsChange } from "../../events";
import { claimQuillsJob, enqueueQuillsJob, finishQuillsJob } from "../queue";
import { pruneQuillsWorkspace } from "../retention";
import { harness } from "./harness.fixture";

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
const h = harness("webhook");
const secret = "whsec_contract";
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-webhook-test-key";

// The HTTP edge: a local receiver that records each request and replies as `respond` says.
type Respond = (req: IncomingMessage, res: ServerResponse) => unknown;
const ok: Respond = (_req, res) => res.writeHead(200).end();
let hits: { headers: IncomingMessage["headers"]; body: string }[] = [];
let respond: Respond = ok;
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    hits.push({ headers: req.headers, body });
    void respond(req, res);
  });
});
let target = "";

const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("*", async (c, next) => {
  c.set("userId", h.owner);
  c.set("user", null);
  await next();
});
app.route("/quills", router);
const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/quills/${h.a}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

const owner = (workspaceId: string) =>
  workspaceId === h.a ? h.owner : h.outsider;
async function hook(
  workspaceId = h.a,
  extra: Partial<typeof webhooks.$inferInsert> = {},
) {
  return h.as(workspaceId, owner(workspaceId), async (db, actor) => {
    const [row] = await db
      .insert(webhooks)
      .values({
        createdById: actor.principalId,
        url: target,
        secret: encryptSecret(secret)!,
        events: ["team.bound"],
        ...extra,
      })
      .returning({ id: webhooks.id });
    return row!.id;
  });
}
const change = (
  entityId: string,
  workspaceId = h.a,
  type: "team.bound" | "team.unbound" = "team.bound",
) =>
  h.as(workspaceId, owner(workspaceId), (db, actor) =>
    recordQuillsChange(db, actor, { type, entityType: "team", entityId }),
  );
const job = async (eventId: string, webhookId: string, workspaceId = h.a) =>
  (
    await h.system(workspaceId, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(eq(jobQueue.dedupeKey, `${eventId}:${webhookId}`)),
    )
  )[0];
const outcome = async (eventId: string, webhookId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({ outcome: hookDeliveries.outcome })
        .from(hookDeliveries)
        .where(eq(hookDeliveries.jobId, `webhook:${eventId}:${webhookId}`)),
    )
  )[0]?.outcome;
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

describe.skipIf(!url)("Quills webhook delivery", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    target = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
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
      await h.system(workspaceId, (db) =>
        db.update(webhooks).set({ deletedAt: new Date() }),
      );
  });

  it("signs each delivery and sends it once, also when the job is replayed", async () => {
    const webhookId = await hook();
    const eventId = await change("signed");
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    const timestamp = hit!.headers["x-kaneo-timestamp"];
    expect(hit!.headers["x-kaneo-signature"]).toBe(
      `sha256=${createHmac("sha256", secret).update(`${timestamp}.${hit!.body}`).digest("hex")}`,
    );
    expect(hit!.headers["x-kaneo-delivery"]).toBe(
      `webhook:${eventId}:${webhookId}`,
    );
    expect(JSON.parse(hit!.body)).toMatchObject({
      id: eventId,
      type: "team.bound",
      data: { entityType: "team", entityId: "signed" },
    });
    const done = (await job(eventId, webhookId))!;
    expect(done.status).toBe("succeeded");
    expect(await outcome(eventId, webhookId)).toBe("completed");

    await replay(done.id);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await job(eventId, webhookId))!.status).toBe("succeeded");
  });

  it("keeps a settings receipt in the audit row only, and refuses an oversized one", async () => {
    await hook();
    const record = (entityId: string, receipt?: unknown) =>
      h.as(h.a, h.owner, (db, actor) =>
        recordQuillsChange(db, actor, {
          type: "team.bound",
          entityType: "team",
          entityId,
          payload: { field: "kept" },
          receipt: receipt as never,
        }),
      );
    const rows = (entityId: string) =>
      h.system(h.a, async (db) => ({
        audit: await db
          .select({ metadata: auditLog.metadata })
          .from(auditLog)
          .where(eq(auditLog.targetId, entityId)),
        events: await db
          .select()
          .from(events)
          .where(eq(events.entityId, entityId)),
      }));
    const receipt = {
      area: "branding",
      before: { theme: { primary: "#111111" }, customCss: "a{color:red}" },
      after: { theme: { primary: "#222222" }, customCss: "a{color:blue}" },
    };
    const eventId = await record("undo-with", receipt);
    const stored = await rows("undo-with");
    expect(stored.audit).toEqual([{ metadata: { field: "kept", receipt } }]);
    expect(stored.events).toHaveLength(1);
    expect(stored.events[0]!.payload).toEqual({ field: "kept" });
    await h.drain(h.a);
    const jobs = await h.system(h.a, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(like(jobQueue.dedupeKey, `${eventId}%`)),
    );
    expect(jobs.length).toBeGreaterThan(0);
    for (const value of [stored.events, jobs, hits.map((hit) => hit.body)])
      expect(
        JSON.stringify(value, (_key, item) =>
          typeof item === "bigint" ? String(item) : item,
        ),
      ).not.toMatch(/#111111|#222222|customCss|receipt/);
    expect(hits).toHaveLength(1);
    expect(JSON.parse(hits[0]!.body).data).toEqual({
      field: "kept",
      entityType: "team",
      entityId: "undo-with",
    });

    // Without a receipt, the audit metadata is the payload, as before.
    await record("undo-without");
    expect((await rows("undo-without")).audit).toEqual([
      { metadata: { field: "kept" } },
    ]);

    // An oversized receipt fails before any write.
    const oversized = {
      area: "branding",
      before: { customCss: "x".repeat(RECEIPT_MAX_BYTES) },
      after: {},
    };
    await expect(record("undo-oversized", oversized)).rejects.toThrow();
    expect(await rows("undo-oversized")).toEqual({ audit: [], events: [] });

    // A caller-minted receipt ID names the audit row; the event never holds it. It needs a receipt.
    const receiptId = createId("audit_log");
    await h.as(h.a, h.owner, (db, actor) =>
      recordQuillsChange(db, actor, {
        type: "team.bound",
        entityType: "team",
        entityId: "undo-named",
        receipt,
        receiptId,
      }),
    );
    const named = await h.system(h.a, async (db) => ({
      audit: await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.targetId, "undo-named")),
      events: await db
        .select()
        .from(events)
        .where(eq(events.entityId, "undo-named")),
    }));
    expect(named.audit).toEqual([{ id: receiptId }]);
    expect(
      JSON.stringify(named.events, (_key, item) =>
        typeof item === "bigint" ? String(item) : item,
      ),
    ).not.toContain(receiptId);
    await expect(
      h.as(h.a, h.owner, (db, actor) =>
        recordQuillsChange(db, actor, {
          type: "team.bound",
          entityType: "team",
          entityId: "undo-id-only",
          receiptId: createId("audit_log"),
        }),
      ),
    ).rejects.toThrow("A receipt ID needs a receipt");
    expect(await rows("undo-id-only")).toEqual({ audit: [], events: [] });
  });

  it("records an uncertain outcome and never sends it again", async () => {
    respond = (req) => req.socket.destroy();
    const webhookId = await hook();
    const eventId = await change("uncertain");
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    const failed = (await job(eventId, webhookId))!;
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.lastError).toContain("uncertain");
    expect(await outcome(eventId, webhookId)).toBe("uncertain");

    respond = ok;
    await replay(failed.id);
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await job(eventId, webhookId))!.status).toBe("failed");
  });

  it("treats an attempt that stopped after its claim as uncertain", async () => {
    const webhookId = await hook();
    const eventId = await change("crashed");
    // A worker claimed this delivery, then its lease expired before it recorded an outcome.
    await h.system(h.a, async (db) => {
      await db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, eventId));
      await enqueueQuillsJob(
        db,
        "quills.webhook",
        { eventId, webhookId },
        `${eventId}:${webhookId}`,
        5,
      );
      await db.insert(hookDeliveries).values({
        jobId: `webhook:${eventId}:${webhookId}`,
        hookType: "webhook",
        outcome: "processing",
      });
    });
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect((await job(eventId, webhookId))!.status).toBe("failed");
    expect(await outcome(eventId, webhookId)).toBe("uncertain");
  });

  it("keeps a delivered outcome when the lease expires during the send", async () => {
    respond = async (_req, res) => {
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({ lockedUntil: new Date(0) })
          .where(eq(jobQueue.queue, "quills.webhook")),
      );
      res.writeHead(204).end();
    };
    const webhookId = await hook();
    const eventId = await change("lease");
    // The first attempt cannot finish its job; the replacement finds the outcome and sends nothing.
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect(await outcome(eventId, webhookId)).toBe("completed");
    expect((await job(eventId, webhookId))!).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
  });

  it("retries with backoff up to the attempt limit, and fails a rejection at once", async () => {
    respond = (_req, res) => res.writeHead(503).end();
    const webhookId = await hook();
    const eventId = await change("unavailable");
    await h.drain(h.a);
    const first = (await job(eventId, webhookId))!;
    expect(first).toMatchObject({ status: "pending", attempts: 1 });
    expect(first.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(await outcome(eventId, webhookId)).toBe("failed");
    // A due delivery job makes the workspace runnable for the scheduler.
    await h.due(h.a);
    const runnable = await pool.query(
      "SELECT quills.runnable_workspaces('') AS id",
    );
    expect(runnable.rows.map((row) => row.id)).toContain(h.a);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await h.due(h.a);
      await h.drain(h.a);
    }
    expect(hits).toHaveLength(5);
    expect((await job(eventId, webhookId))!).toMatchObject({
      status: "failed",
      attempts: 5,
      lastError: "HTTP 503",
    });
    const [stats] = await h.system(h.a, (db) =>
      db
        .select({ failureCount: webhooks.failureCount })
        .from(webhooks)
        .where(eq(webhooks.id, webhookId)),
    );
    expect(stats!.failureCount).toBe(5);

    respond = (_req, res) => res.writeHead(400).end();
    const rejected = await change("rejected");
    await h.drain(h.a);
    expect((await job(rejected, webhookId))!).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "HTTP 400",
    });
  });

  it("rejects private and loopback targets when it creates and when it delivers", async () => {
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
        (await call("/webhooks", "POST", { url: bad, events: ["team.bound"] }))
          .status,
      ).toBe(400);
    // A row that bypassed the route, or whose host now resolves privately, is still refused.
    const webhookId = await hook();
    expect(
      (
        await call(`/webhooks/${webhookId}`, "PATCH", {
          url: "https://127.0.0.1/hook",
        })
      ).status,
    ).toBe(400);
    const eventId = await change("private");
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect((await job(eventId, webhookId))!).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Destination is not a public address",
    });
  });

  it("delivers only inside the event's workspace", async () => {
    const own = await hook(h.a);
    const foreign = await hook(h.b);
    const eventId = await change("isolated");
    await h.drain(h.a);
    await h.drain(h.b);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.headers["x-kaneo-delivery"]).toBe(
      `webhook:${eventId}:${own}`,
    );
    expect(await job(eventId, foreign, h.b)).toBeUndefined();
    // A job in A that names B's webhook cannot read it.
    await h.system(h.a, (db) =>
      enqueueQuillsJob(
        db,
        "quills.webhook",
        { eventId, webhookId: foreign },
        `${eventId}:${foreign}`,
        5,
      ),
    );
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
    expect((await job(eventId, foreign))!.status).toBe("succeeded");
  });

  it("sends nothing for a rolled-back mutation", async () => {
    await hook();
    await expect(
      h.as(h.a, h.owner, async (db, actor) => {
        await recordQuillsChange(db, actor, {
          type: "team.bound",
          entityType: "team",
          entityId: "rolled-back",
        });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    expect(
      await h.system(h.a, (db) =>
        db.select().from(events).where(eq(events.entityId, "rolled-back")),
      ),
    ).toHaveLength(0);
  });

  it("delivers no backlog and applies the board filter and private comments by the stored rows", async () => {
    const rows = await h.as(h.a, h.owner, async (db, actor) => {
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .limit(1);
      const board = async (slug: string) =>
        (
          await db
            .insert(boards)
            .values({ name: slug, slug: `${slug}-${Date.now()}` })
            .returning({ id: boards.id })
        )[0]!.id;
      const wantedBoard = await board("wanted"),
        otherBoard = await board("other");
      const post = async (boardId: typeof wantedBoard) =>
        (
          await db
            .insert(posts)
            .values({
              title: "Post",
              content: "Post",
              boardId,
              principalId: actor.principalId,
              statusId: status!.id,
            })
            .returning({ id: posts.id })
        )[0]!.id;
      const wantedPost = await post(wantedBoard);
      const comment = async (isPrivate: boolean) =>
        (
          await db
            .insert(postComments)
            .values({
              postId: wantedPost,
              principalId: actor.principalId,
              content: "Comment",
              isPrivate,
            })
            .returning({ id: postComments.id })
        )[0]!.id;
      return {
        wantedBoard,
        otherBoard,
        wantedPost,
        otherPost: await post(otherBoard),
        privateComment: await comment(true),
        publicComment: await comment(false),
      };
    });
    const webhookId = await hook(h.a, {
      boardIds: [rows.wantedBoard],
      events: [
        "team.bound",
        "board.project_linked",
        "post.task_linked",
        "comment.created",
      ],
    });
    const emit = (type: string, entityType: string, entityId: string) =>
      h.emit(h.a, { type, entityType, entityId });
    await h.emit(h.a, {
      type: "team.bound",
      entityType: "team",
      entityId: "backlog",
      deliver: false,
    });
    const delivered = [
      await emit("board.project_linked", "board", rows.wantedBoard),
      await emit("post.task_linked", "post", rows.wantedPost),
      await emit("comment.created", "comment", rows.publicComment),
      // A board filter does not apply to an event about no board.
      await emit("team.bound", "team", "boardless"),
    ];
    await emit("board.project_linked", "board", rows.otherBoard);
    await emit("post.task_linked", "post", rows.otherPost);
    await emit("comment.created", "comment", rows.privateComment);
    // Only the later webhook hears team.unbound, and this event happened before it existed.
    const before = await change("before-webhook", h.a, "team.unbound");
    const later = await hook(h.a, { events: ["team.unbound"] });
    await h.drain(h.a);
    expect(hits.map((hit) => JSON.parse(hit.body).id)).toEqual(delivered);
    expect(await job(before, later)).toBeUndefined();
    expect(await job(delivered[0]!, webhookId)).toBeDefined();
  });

  it("skips a delivery whose webhook was disabled or deleted after it was queued", async () => {
    const disabled = await hook();
    const deleted = await hook();
    const eventId = await change("changed-after-queue");
    await h.system(h.a, async (db) => {
      await db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, eventId));
      for (const webhookId of [disabled, deleted])
        await enqueueQuillsJob(
          db,
          "quills.webhook",
          { eventId, webhookId },
          `${eventId}:${webhookId}`,
          5,
        );
      await db
        .update(webhooks)
        .set({ status: "disabled" })
        .where(eq(webhooks.id, disabled));
      await db
        .update(webhooks)
        .set({ deletedAt: new Date() })
        .where(eq(webhooks.id, deleted));
    });
    await h.drain(h.a);
    expect(hits).toHaveLength(0);
    for (const webhookId of [disabled, deleted]) {
      expect((await job(eventId, webhookId))!.status).toBe("succeeded");
      expect(await outcome(eventId, webhookId)).toBeUndefined();
    }
  });

  it("claims a cache invalidation before an older ready delivery", async () => {
    const webhookId = await hook();
    const older = await change("older");
    await h.system(h.a, async (db) => {
      await db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, older));
      await db
        .update(jobQueue)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(jobQueue.dedupeKey, older));
      await enqueueQuillsJob(
        db,
        "quills.webhook",
        { eventId: older, webhookId },
        `${older}:${webhookId}`,
        5,
      );
    });
    const newer = await change("newer");
    const claimed = (await h.system(h.a, claimQuillsJob))!;
    expect(claimed).toMatchObject({ queue: "quills.event", dedupeKey: newer });
    await h.system(h.a, async (db) => {
      await finishQuillsJob(db, claimed.id, claimed.leaseToken!);
      await db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, newer));
    });
    await h.drain(h.a);
    expect(hits).toHaveLength(1);
  });

  it("keeps ledger rows while their event is unpublished and prunes the rest", async () => {
    const published = await change("prune-published");
    const pending = await change("prune-pending");
    await h.system(h.a, async (db) => {
      await db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, published));
      for (const eventId of [published, pending])
        await db.insert(hookDeliveries).values({
          jobId: `webhook:${eventId}:old`,
          hookType: "webhook",
          outcome: "completed",
          processedAt: new Date(Date.now() - 10 * 86400000),
        });
      await pruneQuillsWorkspace(db, { events: 1 });
    });
    const kept = await h.system(h.a, (db) =>
      db
        .select({ jobId: hookDeliveries.jobId })
        .from(hookDeliveries)
        .where(like(hookDeliveries.jobId, "%:old")),
    );
    expect(kept).toEqual([{ jobId: `webhook:${pending}:old` }]);
    await h.system(h.a, (db) =>
      db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, pending)),
    );
  });

  it("shows the signing secret once, on create and rotate, and stores it encrypted", async () => {
    const created = await call("/webhooks", "POST", {
      url: "https://203.0.113.10/hook",
      events: ["team.bound"],
    });
    expect(created.status).toBe(200);
    const { webhook, secret: first } = await created.json();
    expect(first).toMatch(/.{32,}/);
    const rotated = await call(`/webhooks/${webhook.id}/rotate`, "POST");
    const { secret: second } = await rotated.json();
    expect(second).not.toBe(first);
    for (const path of ["/webhooks", `/webhooks/${webhook.id}`]) {
      const text = await (await call(path)).text();
      expect(text).toContain(webhook.id);
      expect(text).not.toContain(first);
      expect(text).not.toContain(second);
      expect(text).not.toMatch(/"secret"/);
    }
    const [stored] = await h.system(h.a, (db) =>
      db
        .select({ secret: webhooks.secret })
        .from(webhooks)
        .where(eq(webhooks.id, webhook.id)),
    );
    expect(stored!.secret).toMatch(/^enc:v1:/);
    expect(stored!.secret).not.toContain(second);

    // The secret shown is the one that signs: point the webhook at the local receiver.
    await h.system(h.a, (db) =>
      db
        .update(webhooks)
        .set({ url: target })
        .where(eq(webhooks.id, webhook.id)),
    );
    await change("rotated");
    await h.drain(h.a);
    const [hit] = hits;
    const timestamp = hit!.headers["x-kaneo-timestamp"];
    expect(hit!.headers["x-kaneo-signature"]).toBe(
      `sha256=${createHmac("sha256", second).update(`${timestamp}.${hit!.body}`).digest("hex")}`,
    );

    const foreignBoard = await h.as(
      h.b,
      h.outsider,
      async (db) =>
        (
          await db
            .insert(boards)
            .values({ name: "Foreign", slug: `foreign-${Date.now()}` })
            .returning({ id: boards.id })
        )[0]!.id,
    );
    expect(
      (
        await call("/webhooks", "POST", {
          url: "https://203.0.113.10/hook",
          events: ["team.bound"],
          boardIds: [foreignBoard],
        })
      ).status,
    ).toBe(404);
  });
});
