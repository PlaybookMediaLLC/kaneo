import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import { aiUsageLog } from "../../../database/quills/schema/ai-usage-log";
import { boards } from "../../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { events } from "../../../database/quills/schema/events";
import { feedbackSignals } from "../../../database/quills/schema/feedback-signals";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { posts } from "../../../database/quills/schema/posts";
import {
  ticketStatuses,
  tickets,
} from "../../../database/quills/schema/tickets";
import {
  chatReply,
  EMBEDDING,
  provider,
  providerUrl,
} from "../../assistant/provider-edge.fixture";
import {
  conversation,
  customer,
  testCustomer,
} from "../../support/conversation-seed.fixture";
import { loadEvent } from "../fanout";
import { claimFrom, enqueueQuillsJob } from "../queue";
import { runAiJob } from "./ai";
import { harness } from "./harness.fixture";
import { extractSignals } from "./signals";

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
const h = harness("signals");
const ASK = "Please add a dark mode. The white screen hurts at night.";

/** The model finds `requests`; every embedding is the constant test vector. */
const extraction = (requests: object[]) =>
  provider.reply(({ path, body }) =>
    path.endsWith("/embeddings")
      ? {
          json: {
            data: (body.input as string[]).map((_, index) => ({
              index,
              embedding: EMBEDDING,
            })),
            usage: { prompt_tokens: 4, total_tokens: 4 },
          },
        }
      : chatReply({ requests }),
  );
const darkMode = { message: 2, excerpt: ASK, title: "Dark mode" };
const chats = () =>
  provider.requests.filter((request) =>
    request.path.endsWith("/chat/completions"),
  );

/**
 * A conversation in A with the seed's customer "Help", agent reply and team note, then a second
 * customer message. `closed` false leaves it open.
 */
const thread = (
  values: Partial<typeof conversations.$inferInsert> = {},
  test = false,
) =>
  h.as(h.a, h.owner, async (db, actor) => {
    const email = `${crypto.randomUUID()}@example.test`;
    const visitor = test
      ? await testCustomer(db, actor.principalId, email)
      : await customer(db, email);
    const seeded = await conversation(db, actor.principalId, visitor, values);
    const [ask] = await db
      .insert(conversationMessages)
      .values({
        conversationId: seeded.conversationId,
        principalId: visitor as never,
        senderType: "visitor",
        content: ASK,
        createdAt: new Date(Date.now() + 1000),
      })
      .returning({ id: conversationMessages.id });
    return { ...seeded, visitor, askId: ask!.id };
  });
const closed = (values: Partial<typeof conversations.$inferInsert> = {}) =>
  thread({ status: "closed", ...values });
const closeEvent = (conversationId: string, workspaceId = h.a) =>
  h.emit(workspaceId, {
    type: "conversation.status_changed",
    entityType: "conversation",
    entityId: conversationId,
    payload: { status: "closed" },
  });
const signalsOf = (where: { conversationId?: string; ticketId?: string }) =>
  h.system(h.a, (db) =>
    db
      .select({
        conversationId: feedbackSignals.conversationId,
        ticketId: feedbackSignals.ticketId,
        sourceMessageId: feedbackSignals.sourceMessageId,
        principalId: feedbackSignals.principalId,
        excerpt: feedbackSignals.excerpt,
        suggestedTitle: feedbackSignals.suggestedTitle,
        matchedPostId: feedbackSignals.matchedPostId,
        status: feedbackSignals.status,
        id: feedbackSignals.id,
      })
      .from(feedbackSignals)
      .where(
        where.ticketId
          ? eq(feedbackSignals.ticketId, where.ticketId as never)
          : eq(feedbackSignals.conversationId, where.conversationId as never),
      ),
  );
const createdEvents = (ids: string[]) =>
  h.system(h.a, (db) =>
    ids.length
      ? db
          .select({ entityId: events.entityId })
          .from(events)
          .where(
            and(
              eq(events.type, "signal.created"),
              inArray(events.entityId, ids),
            ),
          )
      : Promise.resolve([]),
  );
const aiJob = async (eventId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({
          id: jobQueue.id,
          status: jobQueue.status,
          attempts: jobQueue.attempts,
        })
        .from(jobQueue)
        .where(
          and(eq(jobQueue.queue, "quills.ai"), eq(jobQueue.dedupeKey, eventId)),
        ),
    )
  )[0];
const ledger = (messageId: string) =>
  h.system(h.a, (db) =>
    db
      .select({ outcome: hookDeliveries.outcome })
      .from(hookDeliveries)
      .where(eq(hookDeliveries.jobId, `signals:${messageId}`)),
  );
/** A live post in `workspaceId` whose embedding is the constant test vector. */
const embeddedPost = (workspaceId: string) =>
  h.as(
    workspaceId,
    workspaceId === h.a ? h.owner : h.outsider,
    async (db, actor) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Ideas", slug: `ideas-${crypto.randomUUID()}` })
        .returning({ id: boards.id });
      const [post] = await db
        .insert(posts)
        .values({
          title: "Dark mode",
          content: "A dark color scheme",
          boardId: board!.id,
          principalId: actor.principalId,
          embedding: sql`${JSON.stringify(EMBEDDING)}::vector` as never,
        })
        .returning({ id: posts.id });
      return post!.id;
    },
  );

describe.skipIf(!url)("Feedback autopilot extraction", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  beforeEach(() => {
    provider.reply();
    provider.requests.length = 0;
  });

  it("never matches a post of another workspace", async () => {
    await embeddedPost(h.b);
    const seeded = await closed();
    extraction([darkMode]);
    await closeEvent(seeded.conversationId);
    await h.drain(h.a);
    expect(await signalsOf(seeded)).toMatchObject([
      { sourceMessageId: seeded.askId, matchedPostId: null },
    ]);
  });

  it("stores one pending signal for each request, matched to a similar post, from customer messages only", async () => {
    const matched = await embeddedPost(h.a);
    const seeded = await closed();
    const usageBefore = await h.system(h.a, (db) => db.$count(aiUsageLog));
    extraction([
      darkMode,
      // A second request on the same message, a message that does not exist and an empty title.
      { message: 2, excerpt: "Again", title: "Again" },
      { message: 9, excerpt: "Nowhere", title: "Nowhere" },
      { message: 1, excerpt: "Help", title: " " },
    ]);
    await closeEvent(seeded.conversationId);
    await h.drain(h.a);

    const rows = await signalsOf(seeded);
    expect(rows).toEqual([
      {
        conversationId: seeded.conversationId,
        ticketId: null,
        sourceMessageId: seeded.askId,
        principalId: seeded.visitor,
        excerpt: ASK,
        suggestedTitle: "Dark mode",
        matchedPostId: matched,
        status: "pending",
        id: expect.any(String),
      },
    ]);
    expect(await createdEvents(rows.map((row) => row.id))).toHaveLength(1);
    expect(await ledger(seeded.askId)).toEqual([{ outcome: "completed" }]);
    // The prompt holds the customer's words and never the agent reply or the team note.
    const [chat] = chats();
    const prompt = JSON.stringify(chat!.body.messages);
    expect(prompt).toContain("[1] Help");
    expect(prompt).toContain(`[2] ${ASK}`);
    expect(prompt).not.toContain("On it");
    expect(prompt).not.toContain("Private context");
    const usage = await h.system(h.a, (db) =>
      db
        .select({ step: aiUsageLog.pipelineStep, status: aiUsageLog.status })
        .from(aiUsageLog)
        .orderBy(asc(aiUsageLog.pipelineStep)),
    );
    expect(usage.length - usageBefore).toBe(2);
    expect(usage).toEqual(
      expect.arrayContaining([
        { step: "signal_embedding", status: "success" },
        { step: "signal_extract", status: "success" },
      ]),
    );
  });

  it("calls the provider once for a thread: a second close event adds nothing", async () => {
    const seeded = await closed();
    extraction([darkMode]);
    await closeEvent(seeded.conversationId);
    await h.drain(h.a);
    expect(chats()).toHaveLength(1);
    const first = await signalsOf(seeded);

    const again = await closeEvent(seeded.conversationId);
    await h.drain(h.a);
    expect(await aiJob(again)).toMatchObject({ status: "succeeded" });
    expect(chats()).toHaveLength(1);
    expect(await signalsOf(seeded)).toEqual(first);
  });

  it("stores one set when two attempts both reached the provider", async () => {
    const seeded = await closed();
    extraction([darkMode]);
    const eventId = await closeEvent(seeded.conversationId);
    const event = (await h.system(h.a, (db) => loadEvent(db, eventId)))!;
    const writes = [
      await extractSignals(h.a, event),
      await extractSignals(h.a, event),
    ];
    for (const write of writes) await h.system(h.a, (db) => write(db));
    const rows = await signalsOf(seeded);
    expect(rows).toHaveLength(1);
    expect(await createdEvents(rows.map((row) => row.id))).toHaveLength(1);
  });

  it("rolls back the signals of an attempt whose lease was lost, then stores them once", async () => {
    const seeded = await closed();
    extraction([darkMode]);
    const eventId = await closeEvent(seeded.conversationId);
    await h.system(h.a, (db) =>
      enqueueQuillsJob(db, "quills.ai", { eventId }, eventId, 3),
    );
    const job = await h.system(h.a, claimFrom(["quills.ai"]));
    expect(job?.dedupeKey).toBe(eventId);
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ lockedUntil: new Date(0) })
        .where(eq(jobQueue.id, job!.id)),
    );
    await expect(runAiJob(h.a, job!)).rejects.toThrow("lease lost");
    expect(await signalsOf(seeded)).toEqual([]);
    expect(await ledger(seeded.askId)).toEqual([]);

    await h.due(h.a);
    await h.drain(h.a);
    expect(await aiJob(eventId)).toMatchObject({ status: "succeeded" });
    expect(await signalsOf(seeded)).toHaveLength(1);
  });

  it("retries a provider failure and stores nothing until an attempt succeeds", async () => {
    const seeded = await closed();
    provider.reply(() => ({ status: 503, json: {} }));
    const eventId = await closeEvent(seeded.conversationId);
    await h.drain(h.a);
    expect(await aiJob(eventId)).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    expect(await signalsOf(seeded)).toEqual([]);
    expect(await ledger(seeded.askId)).toEqual([]);

    extraction([darkMode]);
    await h.due(h.a);
    await h.drain(h.a);
    expect(await aiJob(eventId)).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(await signalsOf(seeded)).toHaveLength(1);
  });

  it("stores the signals without a match when the embedding call fails", async () => {
    const seeded = await closed();
    provider.reply(({ path }) =>
      path.endsWith("/embeddings")
        ? { status: 503, json: {} }
        : chatReply({ requests: [darkMode] }),
    );
    const eventId = await closeEvent(seeded.conversationId);
    await h.drain(h.a);
    expect(await aiJob(eventId)).toMatchObject({ status: "succeeded" });
    expect(await signalsOf(seeded)).toMatchObject([
      { sourceMessageId: seeded.askId, matchedPostId: null },
    ]);
    const [failed] = await h.system(h.a, (db) =>
      db
        .select({ status: aiUsageLog.status, error: aiUsageLog.error })
        .from(aiUsageLog)
        .where(eq(aiUsageLog.pipelineStep, "signal_embedding"))
        .orderBy(sql`${aiUsageLog.createdAt} desc`)
        .limit(1),
    );
    expect(failed).toEqual({ status: "error", error: "unavailable" });
  });

  it("does nothing and records nothing while AI is off", async () => {
    const seeded = await closed();
    const since = new Date();
    vi.stubEnv("QUILLS_AI_BASE_URL", "");
    try {
      const eventId = await closeEvent(seeded.conversationId);
      await h.drain(h.a);
      expect(await aiJob(eventId)).toMatchObject({ status: "succeeded" });
    } finally {
      vi.stubEnv("QUILLS_AI_BASE_URL", providerUrl);
    }
    expect(provider.requests).toEqual([]);
    expect(await signalsOf(seeded)).toEqual([]);
    expect(await ledger(seeded.askId)).toEqual([]);
    expect(
      await h.system(h.a, (db) =>
        db.$count(aiUsageLog, gte(aiUsageLog.createdAt, since)),
      ),
    ).toBe(0);
  });

  it("skips an open conversation, a spam close and a test customer's conversation", async () => {
    const open = await thread();
    const spam = await closed({ endReason: "spam" });
    const test = await thread({ status: "closed" }, true);
    extraction([darkMode]);
    for (const seeded of [open, spam, test])
      await closeEvent(seeded.conversationId);
    await h.drain(h.a);
    expect(chats()).toEqual([]);
    for (const seeded of [open, spam, test])
      expect(await signalsOf(seeded)).toEqual([]);
  });

  it("reads a resolved ticket's customer messages", async () => {
    const seeded = await h.as(h.a, h.owner, async (db) => {
      const visitor = await customer(db, `${crypto.randomUUID()}@example.test`);
      const [status] = await db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.isDefault, true));
      const [ticket] = await db
        .insert(tickets)
        .values({
          title: "Export fails",
          statusId: status!.id,
          requesterPrincipalId: visitor,
          resolvedAt: new Date(),
        })
        .returning({ id: tickets.id });
      const [message] = await db
        .insert(conversationMessages)
        .values({
          ticketId: ticket!.id,
          principalId: visitor,
          senderType: "visitor",
          content: "The CSV export stops at 1,000 rows.",
        })
        .returning({ id: conversationMessages.id });
      return { ticketId: ticket!.id, messageId: message!.id, visitor };
    });
    extraction([
      { message: 1, excerpt: "The CSV export stops", title: "Full CSV export" },
    ]);
    await h.emit(h.a, {
      type: "ticket.status_changed",
      entityType: "ticket",
      entityId: seeded.ticketId,
    });
    await h.drain(h.a);
    expect(await signalsOf(seeded)).toMatchObject([
      {
        ticketId: seeded.ticketId,
        conversationId: null,
        sourceMessageId: seeded.messageId,
        principalId: seeded.visitor,
        suggestedTitle: "Full CSV export",
      },
    ]);
  });
});
