import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { assistantSnippets } from "../../database/quills/schema/assistant";
import { agentSkills } from "../../database/quills/schema/agent-skills";
import { assistantGuidanceRules } from "../../database/quills/schema/assistant-guidance";
import { conversationMessages } from "../../database/quills/schema/conversation";
import type { BaseVariables } from "../../openapi";
import router from "..";
import { thread } from "../ai-eval/thread";
import type { DeliveryEvent } from "../jobs/fanout";
import { harness } from "../jobs/handlers/harness.fixture";
import { embedSnippet } from "./engine/embed-knowledge";
import {
  chatReply,
  provider,
  type ProviderRequest,
} from "./provider-edge.fixture";

// The customer agent (engine/customer-agent.ts) on the tool loop: guidance and skills assigned to
// it, search by meaning over embedded snippets, and its own search tool.

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
vi.mock("../../ws", () => ({ broadcastToUserAndWait: vi.fn(async () => {}) }));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("custagent");
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
const call = async (path: string, method = "GET", body?: unknown) => {
  const res = await app.request(`/quills/${h.a}${path}`, {
    method,
    headers: {
      "x-user": h.owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as any,
  };
};

/** Two meanings: money back and refunds are one; anything else is the other. */
const vectorFor = (text: string) =>
  Array.from({ length: 1536 }, (_, i) =>
    /refund|money back/i.test(text) ? (i % 2 ? 1 : 0) : i % 2 ? 0 : 1,
  );
const answer = (value: object = {}) =>
  chatReply({
    reply: "Done.",
    handoff: null,
    feedback: null,
    sourceIds: [],
    ...value,
  });
/** Embeddings by meaning; chat answers from `chat`. */
const script = (
  chat: (request: ProviderRequest) => ReturnType<typeof chatReply>,
) =>
  provider.reply((request) =>
    request.path.endsWith("/embeddings")
      ? {
          json: {
            data: (request.body.input as string[]).map((text, index) => ({
              index,
              embedding: vectorFor(text),
            })),
            usage: { prompt_tokens: 3, total_tokens: 3 },
          },
        }
      : chat(request),
  );
const chats = () =>
  provider.requests.filter((r) => r.path.endsWith("/chat/completions"));
const ask = async (text: string) => {
  const { conversationId, lastCustomerMessageId } = await thread(h, [
    { from: "customer", text },
  ]);
  await h.emit(h.a, {
    type: "message.created",
    entityType: "conversation_message",
    entityId: lastCustomerMessageId!,
    payload: { conversationId },
  });
  await h.drain(h.a);
  const [reply] = await h.system(h.a, (db) =>
    db
      .select({
        content: conversationMessages.content,
        citations: conversationMessages.citations,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId as never),
          eq(conversationMessages.senderType, "agent"),
        ),
      ),
  );
  return reply;
};

describe.skipIf(!url)("customer agent", () => {
  let refundId = "";
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    script(() => answer());
    const current = await call("/assistant/settings");
    await call("/assistant/settings", "PATCH", {
      revision: current.body.revision,
      agentEnabled: true,
      agentKnowledge: {
        helpCenter: false,
        posts: false,
        changelog: false,
        documents: false,
        status: false,
      },
    });
    const refund = await call("/assistant/snippets", "POST", {
      title: "Returns",
      content: "Refunds are available within 30 days of purchase.",
      audience: "public",
      enabled: true,
    });
    refundId = refund.body.id;
    await call("/assistant/snippets", "POST", {
      title: "Shipping",
      content: "Orders ship in 2 business days.",
      audience: "public",
      enabled: true,
    });
    // The snippet events embed both snippets (embed-knowledge.ts).
    await h.drain(h.a);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  beforeEach(() => {
    provider.requests.length = 0;
  });

  it("embeds each new snippet, and embeds an edited snippet again", async () => {
    const embedded = () =>
      h.system(h.a, (db) =>
        db
          .select({ id: assistantSnippets.id })
          .from(assistantSnippets)
          .where(isNotNull(assistantSnippets.embedding)),
      );
    expect(await embedded()).toHaveLength(2);
    await call(`/assistant/snippets/${refundId}`, "PATCH", {
      content: "Refunds are available within 45 days of purchase.",
    });
    await h.drain(h.a);
    expect(await embedded()).toHaveLength(2);
  });

  it("finds a snippet by meaning when the question shares no word with it", async () => {
    script(() => answer());
    await ask("Can I get my money back?");
    const sources = JSON.stringify(chats()[0]!.body.messages);
    expect(sources).toContain("45 days");
    expect(sources).not.toContain("2 business days");
  });

  it("searches again with its tool and cites what it found", async () => {
    let step = 0;
    script(({ body }) =>
      step++ === 0
        ? chatReply(null, [
            {
              id: "s1",
              type: "function",
              function: {
                name: "search_knowledge",
                arguments: '{"query":"shipping times"}',
              },
            },
          ])
        : answer({
            reply: "Orders ship in 2 business days.",
            sourceIds: [
              JSON.stringify(body.messages).match(
                /\[snippet:([^\]]+)\] Shipping/,
              )?.[1] ?? "",
            ],
          }),
    );
    const reply = await ask("When does my parcel leave?");
    expect(
      chats()[0]!.body.tools.map(
        (t: { function: { name: string } }) => t.function.name,
      ),
    ).toContain("search_knowledge");
    expect(chats()[1]!.body.messages.at(-1).content).toContain(
      "2 business days",
    );
    expect(reply!.content).toBe("Orders ship in 2 business days.");
    expect(reply!.citations?.[0]?.title).toBe("Shipping");
  });

  it("follows the guidance and skills assigned to it, and not the copilot's", async () => {
    await h.as(h.a, h.owner, async (db) => {
      await db.insert(assistantGuidanceRules).values([
        {
          name: "Sign off",
          instruction: "AGENT-RULE end with a thank-you.",
          agent: "agent",
          enabled: true,
          priority: 1,
        },
        {
          name: "Internal",
          instruction: "COPILOT-RULE cite tickets.",
          agent: "copilot",
          enabled: true,
          priority: 1,
        },
      ] as never);
      await db.insert(agentSkills).values({
        name: "Billing",
        whenToUse: "billing questions",
        instructions: "AGENT-SKILL check the plan first.",
        enabled: true,
        assignments: { agent: true, copilot: false },
      } as never);
    });
    script(() => answer());
    await ask("Do you ship abroad?");
    const system = chats()[0]!.body.messages[0].content as string;
    expect(system).toContain("AGENT-RULE");
    expect(system).toContain("AGENT-SKILL");
    expect(system).not.toContain("COPILOT-RULE");
  });

  it("answers from a word match when the embedding call fails, and tries it once", async () => {
    provider.reply((request) =>
      request.path.endsWith("/embeddings")
        ? { status: 503, json: {} }
        : answer({
            reply: "Within 45 days.",
            confidence: 0.95,
            sourceIds: [refundId],
            quotedExcerpt: "Refunds are available within 45 days of purchase.",
          }),
    );
    const reply = await ask("What is the refund window?");
    expect(reply!.content).toBe("Within 45 days.");
    expect(JSON.stringify(chats()[0]!.body.messages)).toContain("45 days");
    expect(
      provider.requests.filter((r) => r.path.endsWith("/embeddings")),
    ).toHaveLength(1);
  });

  it("logs its usage when the answer is not JSON, and stores no reply", async () => {
    const usageRows = () =>
      h.system(h.a, (db) =>
        db
          .select({ id: aiUsageLog.id })
          .from(aiUsageLog)
          .where(eq(aiUsageLog.pipelineStep, "customer_agent")),
      );
    const before = (await usageRows()).length;
    script(() => chatReply("Sorry, I cannot help with that."));
    expect(await ask("Do you have a phone number?")).toBeUndefined();
    expect((await usageRows()).length).toBeGreaterThan(before);
  });

  it("never stores a vector for text that changed while it was embedded", async () => {
    script(() => answer());
    const created = await call("/assistant/snippets", "POST", {
      title: "Warranty",
      content: "Two years.",
      audience: "public",
      enabled: true,
    });
    const id = created.body.id as string;
    // The job reads and embeds; a teammate edits before its write runs.
    const write = await embedSnippet(h.a, {
      type: "assistant_snippet.created",
      entityId: id,
      payload: {},
    } as unknown as DeliveryEvent);
    await call(`/assistant/snippets/${id}`, "PATCH", {
      content: "Three years.",
    });
    await h.system(h.a, write);
    const embedded = () =>
      h.system(h.a, (db) =>
        db
          .select({ id: assistantSnippets.id })
          .from(assistantSnippets)
          .where(
            and(
              eq(assistantSnippets.id, id as never),
              isNotNull(assistantSnippets.embedding),
            ),
          ),
      );
    expect(await embedded()).toEqual([]);
    // The edit's own event embeds the new text.
    await h.drain(h.a);
    expect(await embedded()).toHaveLength(1);
  });
});
