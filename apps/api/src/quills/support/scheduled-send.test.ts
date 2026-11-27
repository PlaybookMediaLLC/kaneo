import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auditLog } from "../../database/quills/schema/audit-log";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { events } from "../../database/quills/schema/events";
import { jobQueue } from "../../database/quills/schema/job-queue";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { drainQuillsWorkspace } from "../jobs/worker";
import { seed as seedConversation } from "./conversation-seed.fixture";
import { side as seedTicketSide } from "./seed.fixture";
import { scheduledDedupeKey } from "./scheduled-send-ops";

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
const app = contractApp(quillsRouter, publicRouter);

async function send(
  method: string,
  path: string,
  options: { user?: string; body?: unknown } = {},
) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe.skipIf(!url)("Quills undo send & scheduled send (#323)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("holds a reply during the undo window, hides it from customers, recalls cleanly and writes audit_log", async () => {
    const env = contractEnv();
    const ids = await seedConversation(env);

    // Enable 15s workspace undo-send delay.
    const setting = await send("PUT", `/quills/${env.a}/support/undo-send`, {
      user: env.owner,
      body: { enabled: true, delaySeconds: 15 },
    });
    expect(setting).toEqual({
      status: 200,
      body: { enabled: true, delaySeconds: 15 },
    });

    // Send reply without explicit scheduledAt -> held for 15s.
    const reply = await send(
      "POST",
      `/quills/${env.a}/conversations/${ids.a.conversationId}/reply`,
      {
        user: env.owner,
        body: { content: "Oops wrong ticket" },
      },
    );
    expect(reply.status).toBe(200);
    expect(reply.body.message.sendStatus).toBe("scheduled");
    expect(reply.body.message.scheduledSendAt).toBeTruthy();
    const messageId: string = reply.body.message.id;

    // Customer-facing preview has NOT changed and message.created was NOT emitted.
    const [convBefore] = await env.scoped(env.a, (db) =>
      db
        .select({ preview: conversations.lastMessagePreview })
        .from(conversations)
        .where(eq(conversations.id, ids.a.conversationId as never)),
    );
    expect(convBefore?.preview).not.toBe("Oops wrong ticket");

    const createdEventsBefore = await env.scoped(env.a, (db) =>
      db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.entityId, messageId),
            eq(events.type, "message.created"),
          ),
        ),
    );
    expect(createdEventsBefore).toEqual([]);

    // Recall (undo) before the window expires.
    const recalled = await send(
      "POST",
      `/quills/${env.a}/conversation-messages/${messageId}/recall`,
      { user: env.owner },
    );
    expect(recalled).toMatchObject({
      status: 200,
      body: {
        recalled: true,
        changed: true,
        messageId,
        content: "Oops wrong ticket",
      },
    });

    // Pending job was removed, recalled message is hidden from list, and audit_log recorded the recall.
    const [pendingJobs, auditRows, listed] = await Promise.all([
      env.scoped(env.a, (db) =>
        db
          .select({ id: jobQueue.id })
          .from(jobQueue)
          .where(eq(jobQueue.dedupeKey, scheduledDedupeKey(messageId))),
      ),
      env.scoped(env.a, (db) =>
        db
          .select({
            eventType: auditLog.eventType,
            targetId: auditLog.targetId,
          })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.eventType, "message.send_recalled"),
              eq(auditLog.targetId, messageId),
            ),
          ),
      ),
      send(
        "GET",
        `/quills/${env.a}/conversations/${ids.a.conversationId}/messages`,
        { user: env.owner },
      ),
    ]);
    expect(pendingJobs).toEqual([]);
    expect(auditRows).toHaveLength(1);
    expect(
      listed.body.items.some((m: { id: string }) => m.id === messageId),
    ).toBe(false);

    // Reset workspace setting so later tests aren't affected.
    await send("PUT", `/quills/${env.a}/support/undo-send`, {
      user: env.owner,
      body: { enabled: false, delaySeconds: 10 },
    });
  });

  it("delivers a scheduled reply when due and rejects recall with 409 afterward", async () => {
    const env = contractEnv();
    const ids = await seedConversation(env);
    const future = new Date(Date.now() + 60_000).toISOString();

    const scheduled = await send(
      "POST",
      `/quills/${env.a}/conversations/${ids.a.conversationId}/reply`,
      {
        user: env.owner,
        body: { content: "Scheduled follow-up", scheduledAt: future },
      },
    );
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.message.sendStatus).toBe("scheduled");
    const messageId: string = scheduled.body.message.id;

    // Fast-forward run_at so the scheduled job is due, then drain quills.workflow.
    await env.scoped(env.a, (db) =>
      db
        .update(jobQueue)
        .set({ runAt: new Date(Date.now() - 1000) })
        .where(eq(jobQueue.dedupeKey, scheduledDedupeKey(messageId))),
    );
    await drainQuillsWorkspace(env.a, async () => {}, ["quills.workflow"]);

    // Message is now 'sent', conversation preview updated, and message.created emitted.
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ sendStatus: conversationMessages.sendStatus })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, messageId as never)),
    );
    expect(row?.sendStatus).toBe("sent");

    const createdEvents = await env.scoped(env.a, (db) =>
      db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.entityId, messageId),
            eq(events.type, "message.created"),
          ),
        ),
    );
    expect(createdEvents).toHaveLength(1);

    // Recalling after send returns 409 Conflict.
    const lateRecall = await send(
      "POST",
      `/quills/${env.a}/conversation-messages/${messageId}/recall`,
      { user: env.owner },
    );
    expect(lateRecall.status).toBe(409);

    // Ticket scheduled reply also supports send-now cleanly.
    const ticketIds = await seedTicketSide(env, env.a, env.owner);
    const ticketReply = await send(
      "POST",
      `/quills/${env.a}/tickets/${ticketIds.ticketId}/reply`,
      {
        user: env.owner,
        body: { content: "Scheduled ticket reply", scheduledAt: future },
      },
    );
    expect(ticketReply.status).toBe(200);
    expect(ticketReply.body.sendStatus).toBe("scheduled");
    const sendNow = await send(
      "POST",
      `/quills/${env.a}/conversation-messages/${ticketReply.body.id}/send-now`,
      { user: env.owner },
    );
    expect(sendNow.status).toBe(200);
    expect(sendNow.body.released).toBe(true);
  });
});
