import { once } from "node:events";
import { createServer } from "node:http";
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
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import {
  assistantDocuments,
  assistantSnippets,
} from "../../database/quills/schema/assistant";
import { assistantPendingActions } from "../../database/quills/schema/assistant-pending-actions";
import { assistantToolCalls } from "../../database/quills/schema/assistant-tool-calls";
import { assistantWebSources } from "../../database/quills/schema/assistant-web-sources";
import { auditLog } from "../../database/quills/schema/audit-log";
import { conversations } from "../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../database/quills/schema/conversation-attributes";
import { conversationSummaries } from "../../database/quills/schema/conversation-summary";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import { events } from "../../database/quills/schema/events";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { posts } from "../../database/quills/schema/posts";
import { postSentiment } from "../../database/quills/schema/sentiment";
import type { BaseVariables } from "../../openapi";
import router from "..";
import { side as feedbackSide } from "../feedback/seed.fixture";
import { runAiJob } from "../jobs/handlers/ai";
import { harness } from "../jobs/handlers/harness.fixture";
import { claimFrom, enqueueQuillsJob } from "../jobs/queue";
import { conversation, customer } from "../support/conversation-seed.fixture";
import {
  chatReply,
  EMBEDDING,
  provider,
  providerUrl,
} from "./provider-edge.fixture";
import { createRun, readRun } from "./runs";
import { writeTools } from "./tools";

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
vi.mock("../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("assistant");
const viewer = `${h.owner}_viewer`;
const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("*", async (c, next) => {
  c.set("userId", c.req.header("x-user")!);
  c.set("user", null);
  await next();
});
app.route("/quills", router);
app.onError((error, c) =>
  error instanceof HTTPException
    ? c.json({ message: error.message }, error.status)
    : c.json({ message: "Internal error" }, 500),
);
const call = async (
  user: string,
  path: string,
  method = "GET",
  body?: unknown,
) => {
  const res = await app.request(`/quills/${h.a}${path}`, {
    method,
    headers: {
      "x-user": user,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as any,
  };
};

/** A conversation in A with a customer message, a reply and a team note. */
const thread = () =>
  h.as(h.a, h.owner, async (db, actor) => {
    const visitor = await customer(db, `${crypto.randomUUID()}@example.test`);
    return (await conversation(db, actor.principalId, visitor)).conversationId;
  });
const priorityOf = async (id: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({ priority: conversations.priority })
        .from(conversations)
        .where(eq(conversations.id, id as never)),
    )
  )[0]!.priority;
/** The model calls one tool, then answers. */
const toolThenAnswer = (name: string, args: object) => {
  let step = 0;
  provider.reply(({ path, body }) => {
    if (path.endsWith("/embeddings"))
      return {
        json: {
          data: body.input.map((_: string, index: number) => ({
            index,
            embedding: EMBEDDING,
          })),
        },
      };
    return step++ === 0
      ? chatReply(null, [
          {
            id: "call_1",
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ])
      : chatReply("I proposed it.");
  });
};
const ask = async (user: string, conversationId: string) => {
  const res = await call(user, "/assistant/copilot", "POST", {
    conversationId,
    question: "Raise the priority?",
  });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("pending");
  await h.drain(h.a);
  return (await call(user, `/assistant/runs/${res.body.id}`)).body;
};
const aiJob = async (eventId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({
          status: jobQueue.status,
          attempts: jobQueue.attempts,
          lastError: jobQueue.lastError,
        })
        .from(jobQueue)
        .where(
          and(eq(jobQueue.queue, "quills.ai"), eq(jobQueue.dedupeKey, eventId)),
        ),
    )
  )[0];
const actionsOn = (conversationId: string) =>
  h.system(h.a, (db) =>
    db
      .select()
      .from(assistantPendingActions)
      .where(
        eq(assistantPendingActions.conversationId, conversationId as never),
      ),
  );

describe.skipIf(!url)("Quills assistant", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    const db = drizzle(pool, { schema: kaneo });
    await db
      .insert(kaneo.userTable)
      .values({ id: viewer, name: viewer, email: `${viewer}@example.test` });
    await db.insert(kaneo.workspaceUserTable).values({
      workspaceId: h.a,
      userId: viewer,
      role: "viewer",
      joinedAt: new Date(),
    });
  }, 120000);
  afterAll(async () => {
    await h.stop();
    if (pool)
      await drizzle(pool)
        .delete(kaneo.userTable)
        .where(eq(kaneo.userTable.id, viewer));
    await pool?.end();
  });
  beforeEach(() => {
    provider.reply();
    provider.requests.length = 0;
  });

  it("offers only write tools whose action the approval route checks", () => {
    // pending-actions.ts approves with quills:update; a tool that needs more could not be approved safely.
    expect(Object.values(writeTools).map((tool) => tool.action)).toEqual(
      Object.keys(writeTools).map(() => "update"),
    );
  });

  it("runs a viewer's copilot tools with the viewer's permissions: nothing is proposed or changed", async () => {
    const id = await thread();
    toolThenAnswer("set_conversation_priority", { priority: "high" });
    const run = await ask(viewer, id);
    expect(run.status).toBe("succeeded");
    expect(run.output.proposedActionIds).toEqual([]);
    expect(await actionsOn(id)).toEqual([]);
    expect(await priorityOf(id)).toBe("none");
    const viewerPrincipal = await h.principal(h.a, viewer);
    const calls = await h.system(h.a, (db) =>
      db
        .select({
          status: assistantToolCalls.status,
          principalId: assistantToolCalls.principalId,
        })
        .from(assistantToolCalls)
        .where(eq(assistantToolCalls.conversationId, id as never)),
    );
    expect(calls).toEqual([{ status: "denied", principalId: viewerPrincipal }]);
    // The viewer cannot approve an action either, so a stored proposal stays unrun.
    const [action] = await h.as(h.a, h.owner, (db) =>
      db
        .insert(assistantPendingActions)
        .values({
          conversationId: id as never,
          toolName: "set_conversation_priority",
          args: { priority: "high" },
          summary: "Set the conversation priority to high",
          expiresAt: new Date(Date.now() + 60000),
        })
        .returning({ id: assistantPendingActions.id }),
    );
    expect(
      (
        await call(
          viewer,
          `/assistant/pending-actions/${action!.id}/approve`,
          "POST",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          viewer,
          `/assistant/pending-actions/${action!.id}/reject`,
          "POST",
        )
      ).status,
    ).toBe(403);
    expect(await priorityOf(id)).toBe("none");
    expect((await actionsOn(id))[0]!.status).toBe("proposed");
  });

  it("lets a member's copilot propose, and runs the action only on a teammate's approval", async () => {
    const id = await thread();
    toolThenAnswer("set_conversation_priority", { priority: "urgent" });
    const run = await ask(h.mate, id);
    expect(run.status).toBe("succeeded");
    expect(run.output.proposedActionIds).toHaveLength(1);
    const [action] = await actionsOn(id);
    expect(action).toMatchObject({
      status: "proposed",
      toolName: "set_conversation_priority",
    });
    expect(await priorityOf(id)).toBe("none");

    const approved = await call(
      h.mate,
      `/assistant/pending-actions/${action!.id}/approve`,
      "POST",
    );
    expect(approved.status).toBe(200);
    expect(approved.body.change).toMatchObject({
      type: "conversation.priority_changed",
      entityId: id,
    });
    expect(await priorityOf(id)).toBe("urgent");
    const mate = await h.principal(h.a, h.mate);
    const [stored] = await actionsOn(id);
    expect(stored).toMatchObject({ status: "executed", decidedById: mate });
    // The change is recorded as the approver's, as the teammate's own route records it.
    const audit = await h.system(h.a, (db) =>
      db
        .select({ actor: auditLog.actorPrincipalId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventType, "conversation.priority_changed"),
            eq(auditLog.targetId, id),
          ),
        ),
    );
    expect(audit).toEqual([{ actor: mate }]);
    expect(
      (
        await call(
          h.mate,
          `/assistant/pending-actions/${action!.id}/approve`,
          "POST",
        )
      ).status,
    ).toBe(409);
  });

  it("never runs a rejected or expired action", async () => {
    const id = await thread();
    const insert = (expiresAt: Date) =>
      h.as(
        h.a,
        h.owner,
        async (db) =>
          (
            await db
              .insert(assistantPendingActions)
              .values({
                conversationId: id as never,
                toolName: "set_conversation_priority",
                args: { priority: "high" },
                summary: "Raise",
                expiresAt,
              })
              .returning({ id: assistantPendingActions.id })
          )[0]!.id,
      );
    const rejected = await insert(new Date(Date.now() + 60000));
    expect(
      (
        await call(
          h.mate,
          `/assistant/pending-actions/${rejected}/reject`,
          "POST",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          h.mate,
          `/assistant/pending-actions/${rejected}/approve`,
          "POST",
        )
      ).status,
    ).toBe(409);
    const expired = await insert(new Date(Date.now() - 1000));
    expect(
      (
        await call(
          h.mate,
          `/assistant/pending-actions/${expired}/approve`,
          "POST",
        )
      ).status,
    ).toBe(409);
    expect(await priorityOf(id)).toBe("none");
  });

  it("stops a run when the requester lost access before the worker ran", async () => {
    const id = await thread();
    const res = await call(viewer, "/assistant/copilot", "POST", {
      conversationId: id,
      question: "Hi",
    });
    expect(res.status).toBe(200);
    await pool.query(
      "UPDATE public.workspace_member SET role='nobody' WHERE user_id=$1",
      [viewer],
    );
    try {
      await h.drain(h.a);
    } finally {
      await pool.query(
        "UPDATE public.workspace_member SET role='viewer' WHERE user_id=$1",
        [viewer],
      );
    }
    const run = await h.system(h.a, (db) => readRun(db, res.body.id));
    expect(run).toMatchObject({
      status: "failed",
      error: "You no longer have access to this workspace",
    });
    expect(provider.requests).toEqual([]);
  });

  it("maps provider failures to fixed messages and logs them without provider text", async () => {
    provider.reply(() => ({
      status: 500,
      json: { error: { message: "raw-provider-secret upstream crash" } },
    }));
    const transform = await call(h.mate, "/assistant/transform", "POST", {
      kind: "rephrase",
      text: "hello",
    });
    expect(transform.status).toBe(502);
    expect(JSON.stringify(transform.body)).not.toContain("raw-provider-secret");
    const run = await ask(h.mate, await thread());
    expect(run).toMatchObject({
      status: "failed",
      error: "The AI provider could not be reached. Try again.",
    });
    const failed = await h.system(h.a, (db) =>
      db
        .select({ error: aiUsageLog.error, status: aiUsageLog.status })
        .from(aiUsageLog)
        .where(eq(aiUsageLog.status, "error")),
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((row) => row.error === "unavailable")).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("raw-provider-secret");
    // The key goes to the provider only, as a bearer token.
    expect(provider.requests[0]!.authorization).toBe(
      "Bearer contract-provider-key",
    );
  });

  it("logs usage per workspace for a successful call", async () => {
    const before = await h.system(h.b, (db) => db.$count(aiUsageLog));
    const res = await call(h.mate, "/assistant/transform", "POST", {
      kind: "translate",
      text: "hello",
      language: "German",
    });
    expect(res).toMatchObject({
      status: 200,
      body: { text: "Contract answer" },
    });
    const rows = await h.system(h.a, (db) =>
      db
        .select({
          step: aiUsageLog.pipelineStep,
          tokens: aiUsageLog.totalTokens,
        })
        .from(aiUsageLog)
        .where(eq(aiUsageLog.pipelineStep, "copilot_transform")),
    );
    expect(rows).toContainEqual({ step: "copilot_transform", tokens: 20 });
    expect(await h.system(h.b, (db) => db.$count(aiUsageLog))).toBe(before);
  });

  it("returns 409 from AI routes without a provider and keeps the rest working", async () => {
    vi.stubEnv("QUILLS_AI_BASE_URL", "");
    try {
      const copilot = await call(h.mate, "/assistant/copilot", "POST", {
        conversationId: await thread(),
        question: "Hi",
      });
      expect(copilot).toMatchObject({
        status: 409,
        body: { message: "AI is not configured" },
      });
      expect(
        (
          await call(h.mate, "/assistant/transform", "POST", {
            kind: "rephrase",
            text: "x",
          })
        ).status,
      ).toBe(409);
      const settings = await call(h.owner, "/assistant/settings");
      expect(settings.body).toMatchObject({ aiConfigured: false });
      const snippet = await call(h.owner, "/assistant/snippets", "POST", {
        title: "Hours",
        content: "Nine to five.",
      });
      expect(snippet.status).toBe(200);
      // Background AI work (here the duplicate check of a new post) finishes with no work.
      const eventId = await h.emit(h.a, {
        type: "post.created",
        entityType: "post",
        entityId: "post_01jz0000000000000000000000",
      });
      await h.drain(h.a);
      expect(await aiJob(eventId)).toMatchObject({ status: "succeeded" });
      expect(provider.requests).toEqual([]);
    } finally {
      vi.stubEnv("QUILLS_AI_BASE_URL", providerUrl);
    }
  });

  describe("the quills.ai worker", () => {
    it("rolls back a copilot answer whose lease was lost, then stores it once", async () => {
      const id = await thread();
      const runId = await h.as(
        h.a,
        h.mate,
        async (db, actor) =>
          (
            await createRun(db, actor.principalId, "copilot", {
              conversationId: id,
              ticketId: null,
              question: "Raise it?",
              history: [],
            })
          ).id,
      );
      const eventId = await h.emit(h.a, {
        type: "assistant_run.requested",
        entityType: "assistant_run",
        entityId: runId,
      });
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
      toolThenAnswer("set_conversation_priority", { priority: "high" });
      await expect(runAiJob(h.a, job!)).rejects.toThrow("lease lost");
      expect(await actionsOn(id)).toEqual([]);
      expect((await h.system(h.a, (db) => readRun(db, runId)))?.status).toBe(
        "pending",
      );

      toolThenAnswer("set_conversation_priority", { priority: "high" });
      await h.due(h.a);
      await h.drain(h.a);
      expect((await h.system(h.a, (db) => readRun(db, runId)))?.status).toBe(
        "succeeded",
      );
      expect(await actionsOn(id)).toHaveLength(1);
      // A repeated request for the finished run calls no provider and writes nothing.
      const calls = provider.requests.length;
      await h.emit(h.a, {
        type: "assistant_run.requested",
        entityType: "assistant_run",
        entityId: runId,
      });
      await h.drain(h.a);
      expect(provider.requests.length).toBe(calls);
      expect(await actionsOn(id)).toHaveLength(1);
    });

    it("retries a background provider failure, then fails the job", async () => {
      const feedback = await feedbackSide(
        {
          scoped: (ws: string, work: any) => h.as(ws, h.owner, work),
          id: (l: string) => `${l}-${crypto.randomUUID()}`,
        } as never,
        h.a,
      );
      provider.reply(() => ({ status: 503, json: {} }));
      expect(
        (await call(h.mate, `/posts/${feedback.postId}/sentiment`, "POST"))
          .status,
      ).toBe(200);
      const [event] = await h.system(h.a, (db) =>
        db
          .select({ eventId: events.eventId })
          .from(events)
          .where(
            and(
              eq(events.type, "post.sentiment_requested"),
              eq(events.entityId, feedback.postId),
            ),
          ),
      );
      await h.drain(h.a);
      expect(await aiJob(event!.eventId)).toMatchObject({
        status: "pending",
        attempts: 1,
      });
      for (const attempt of [2, 3]) {
        await h.due(h.a);
        await h.drain(h.a);
        expect((await aiJob(event!.eventId))?.attempts).toBe(attempt);
      }
      expect(await aiJob(event!.eventId)).toMatchObject({
        status: "failed",
        lastError: "quills.ai failed",
      });
      expect(await h.system(h.a, (db) => db.$count(postSentiment))).toBe(0);
    });

    it("fails a background job at once when AI was turned off after the request", async () => {
      const id = await thread();
      expect(
        (await call(h.mate, `/conversations/${id}/summary`, "POST")).status,
      ).toBe(200);
      const [event] = await h.system(h.a, (db) =>
        db
          .select({ eventId: events.eventId })
          .from(events)
          .where(
            and(
              eq(events.type, "conversation.summary_requested"),
              eq(events.entityId, id),
            ),
          ),
      );
      vi.stubEnv("QUILLS_AI_BASE_URL", "");
      try {
        await h.drain(h.a);
      } finally {
        vi.stubEnv("QUILLS_AI_BASE_URL", providerUrl);
      }
      expect(await aiJob(event!.eventId)).toMatchObject({
        status: "failed",
        attempts: 1,
        lastError: "AI is not configured",
      });
    });

    it("is runnable on its own, and delivery claims never take it", async () => {
      const eventId = await h.emit(h.b, {
        type: "workspace.imported",
        entityType: "workspace",
        entityId: h.b,
      });
      await h.drain(h.b);
      await h.system(h.b, (db) =>
        enqueueQuillsJob(db, "quills.ai", { eventId }, eventId, 3),
      );
      const { rows } = await pool.query(
        "SELECT quills.runnable_workspaces('') AS id",
      );
      expect(rows.map((row) => row.id)).toContain(h.b);
      expect(
        await h.system(h.b, claimFrom(["quills.event", "quills.webhook"])),
      ).toBeUndefined();
      await h.drain(h.b);
    });
  });

  it("shows a run only to the teammate who started it", async () => {
    const res = await call(h.mate, "/assistant/copilot", "POST", {
      conversationId: await thread(),
      question: "Hi",
    });
    expect((await call(h.mate, `/assistant/runs/${res.body.id}`)).status).toBe(
      200,
    );
    expect((await call(h.owner, `/assistant/runs/${res.body.id}`)).status).toBe(
      404,
    );
    await h.drain(h.a);
  });

  it("leaves an approved action proposed when the domain check fails", async () => {
    const id = await thread();
    await h.as(h.a, h.owner, (db) =>
      db.insert(conversationAttributeDefinitions).values({
        key: `required_${crypto.randomUUID().slice(0, 8)}`,
        label: "Reason",
        fieldType: "text",
        requiredToClose: true,
      }),
    );
    try {
      const [action] = await h.as(h.a, h.owner, (db) =>
        db
          .insert(assistantPendingActions)
          .values({
            conversationId: id as never,
            toolName: "set_conversation_status",
            args: { status: "closed" },
            summary: "Close",
            expiresAt: new Date(Date.now() + 60000),
          })
          .returning({ id: assistantPendingActions.id }),
      );
      const res = await call(
        h.mate,
        `/assistant/pending-actions/${action!.id}/approve`,
        "POST",
      );
      expect(res.status).toBe(409);
      expect((await actionsOn(id))[0]!.status).toBe("proposed");
    } finally {
      await h.system(h.a, (db) =>
        db
          .update(conversationAttributeDefinitions)
          .set({ requiredToClose: false })
          .where(eq(conversationAttributeDefinitions.requiredToClose, true)),
      );
    }
  });

  it("rejects a stale settings revision", async () => {
    const current = await call(h.owner, "/assistant/settings");
    const update = (revision: number) =>
      call(h.owner, "/assistant/settings", "PATCH", {
        revision,
        name: "Robin",
      });
    expect((await update(current.body.revision)).status).toBe(200);
    expect((await update(current.body.revision)).status).toBe(409);
  });

  it("does not translate a message of another conversation", async () => {
    const first = await thread();
    const second = await h.as(h.a, h.owner, async (db, actor) => {
      const visitor = await customer(db, `${crypto.randomUUID()}@example.test`);
      return conversation(db, actor.principalId, visitor);
    });
    const res = await call(
      h.mate,
      `/conversations/${first}/messages/${second.visitorMessageId}/translate`,
      "POST",
      { language: "German" },
    );
    expect(res.status).toBe(404);
  });

  it("summarizes a conversation in the worker", async () => {
    const id = await thread();
    expect(
      (await call(h.mate, `/conversations/${id}/summary`, "POST")).status,
    ).toBe(200);
    await h.drain(h.a);
    const [row] = await h.system(h.a, (db) =>
      db
        .select({ summary: conversationSummaries.summary })
        .from(conversationSummaries)
        .where(eq(conversationSummaries.conversationId, id as never)),
    );
    expect(row).toEqual({ summary: "Contract answer" });
  });

  it("answers a widget question from public articles only", async () => {
    const ids = await h.as(h.a, h.owner, async (db, actor) => {
      const [category] = await db
        .insert(helpCenterCategories)
        .values({ name: "Help", slug: `help-${crypto.randomUUID()}` })
        .returning({ id: helpCenterCategories.id });
      const article = (title: string, segmentIds: string[]) =>
        db
          .insert(helpCenterArticles)
          .values({
            categoryId: category!.id,
            title,
            slug: `a-${crypto.randomUUID()}`,
            content: `${title}: refunds take five days`,
            principalId: actor.principalId,
            publishedAt: new Date(),
            segmentIds,
          })
          .returning({ id: helpCenterArticles.id })
          .then((rows) => rows[0]!.id);
      const [teamCategory] = await db
        .insert(helpCenterCategories)
        .values({
          name: "Team",
          slug: `team-${crypto.randomUUID()}`,
          isPublic: false,
        })
        .returning({ id: helpCenterCategories.id });
      const [teamOnly] = await db
        .insert(helpCenterArticles)
        .values({
          categoryId: teamCategory!.id,
          title: "Refund policy for staff",
          slug: `a-${crypto.randomUUID()}`,
          content: "Refunds for staff",
          principalId: actor.principalId,
          publishedAt: new Date(),
        })
        .returning({ id: helpCenterArticles.id });
      const [snippet] = await db
        .insert(assistantSnippets)
        .values({
          title: "Refund override",
          content: "Refund codes for the team",
          audience: "team",
        })
        .returning({ id: assistantSnippets.id });
      const [document] = await db
        .insert(assistantDocuments)
        .values({
          title: "Refund handbook",
          fileName: "refunds.md",
          mimeType: "text/markdown",
          content: "Refund rules",
        })
        .returning({ id: assistantDocuments.id });
      const scheduled = await db
        .insert(helpCenterArticles)
        .values({
          categoryId: category!.id,
          title: "Refund policy next year",
          slug: `a-${crypto.randomUUID()}`,
          content: "Refunds later",
          principalId: actor.principalId,
          publishedAt: new Date(Date.now() + 86400000),
        })
        .returning({ id: helpCenterArticles.id });
      return {
        open: await article("Refund policy", []),
        gated: await article("Refund policy for partners", ["segment_x"]),
        hidden: [teamOnly!.id, snippet!.id, scheduled[0]!.id],
        document: document!.id,
        visitor: await customer(db, `${crypto.randomUUID()}@example.test`),
      };
    });
    let sources = "";
    provider.reply(({ body }) => {
      sources = JSON.stringify(body.messages);
      return chatReply({
        text: "Five days.",
        sourceIds: [ids.open, ids.gated, ids.document, ...ids.hidden],
      });
    });
    const runId = await h.as(
      h.a,
      h.owner,
      async (db) =>
        (await createRun(db, ids.visitor, "kb_ask", { question: "refund" })).id,
    );
    await h.emit(h.a, {
      type: "assistant_run.requested",
      entityType: "assistant_run",
      entityId: runId,
    });
    await h.drain(h.a);
    const run = await h.system(h.a, (db) => readRun(db, runId));
    expect(run?.status).toBe("succeeded");
    expect(run?.output?.citations.map((c) => c.id).sort()).toEqual(
      [ids.open, ids.document].sort(),
    );
    for (const hidden of [ids.gated, ...ids.hidden])
      expect(sources).not.toContain(hidden);
  });

  it("finds a duplicate post with embeddings and merges it on acceptance", async () => {
    const feedback = await feedbackSide(
      {
        scoped: (ws: string, work: any) => h.as(ws, h.owner, work),
        id: (l: string) => `${l}-${crypto.randomUUID()}`,
      } as never,
      h.a,
    );
    const other = await h.as(h.a, h.owner, async (db, actor) => {
      const [row] = await db
        .insert(posts)
        .values({
          title: "Dark mode please",
          content: "Dark mode",
          boardId: feedback.boardId as never,
          principalId: actor.principalId,
          statusId: feedback.statusId as never,
        })
        .returning({ id: posts.id });
      await db.execute(
        sql`UPDATE quills.posts SET embedding = array_fill(0.01::real, ARRAY[1536])::vector WHERE id = ${sql.param(row!.id, posts.id)}`,
      );
      return row!.id;
    });
    provider.reply(({ path, body }) =>
      path.endsWith("/embeddings")
        ? {
            json: {
              data: body.input.map((_: string, index: number) => ({
                index,
                embedding: EMBEDDING,
              })),
            },
          }
        : chatReply({
            duplicate: true,
            confidence: 0.9,
            reasoning: "Same request",
          }),
    );
    expect(
      (await call(h.mate, `/posts/${feedback.postId}/merge-check`, "POST"))
        .status,
    ).toBe(200);
    await h.drain(h.a);
    const [suggestion] = await h.system(h.a, (db) =>
      db
        .select()
        .from(mergeSuggestions)
        .where(eq(mergeSuggestions.targetPostId, other as never)),
    );
    expect(suggestion).toMatchObject({
      status: "pending",
      sourcePostId: feedback.postId,
    });
    const similar = await call(h.mate, `/posts/${feedback.postId}/similar`);
    expect(similar.body.items.map((item: { id: string }) => item.id)).toContain(
      other,
    );
    const accepted = await call(
      h.mate,
      `/suggestions/${suggestion!.id}/accept`,
      "POST",
      { swapDirection: false },
    );
    expect(accepted).toMatchObject({
      status: 200,
      body: { duplicatePostId: feedback.postId, canonicalPostId: other },
    });
    expect(
      (await call(viewer, `/suggestions/${suggestion!.id}/dismiss`, "POST"))
        .status,
    ).toBe(403);
  });

  describe("web sources", () => {
    const page = createServer((_req, res) =>
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<html><head><title>Shipping</title></head><body><p>We ship in two days.</p><script>x()</script></body></html>",
        ),
    );
    let pageUrl = "";
    beforeAll(async () => {
      page.listen(0, "127.0.0.1");
      await once(page, "listening");
      pageUrl = `http://127.0.0.1:${(page.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      page.close();
    });
    const add = async (path: string) => {
      const res = await call(h.owner, "/assistant/web-sources", "POST", {
        url: `${pageUrl}/${path}`,
      });
      expect(res.body.status).toBe("pending");
      await h.drain(h.a);
      return (
        await h.system(h.a, (db) =>
          db
            .select({
              title: assistantWebSources.title,
              content: assistantWebSources.content,
            })
            .from(assistantWebSources)
            .where(eq(assistantWebSources.id, res.body.id)),
        )
      )[0]!;
    };

    it("refuses a page on a private address", async () => {
      delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
      expect(await add("private")).toMatchObject({ content: "" });
      const list = await call(h.owner, "/assistant/web-sources");
      expect(
        list.body.items.find((item: { url: string }) =>
          item.url.endsWith("/private"),
        ).status,
      ).toBe("failed");
    });

    it("stores the text of an allowed page", async () => {
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
      try {
        expect(await add("allowed")).toEqual({
          title: "Shipping",
          content: "We ship in two days.",
        });
      } finally {
        delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
      }
    });
  });
});
