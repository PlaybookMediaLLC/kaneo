import {
  agentDeclineTopics,
  aiEvalRuns,
  assistantDraftReplies,
} from "../../database/quills/schema/agent-guardrails";
import { fixture, type ContractEnv } from "../framework/contract";
import { seed as seedConversations } from "../support/conversation-seed.fixture";

async function seedTopic(env: ContractEnv, ws: string, slug: string) {
  return env.scoped(ws, async (db) => {
    const [row] = await db
      .insert(agentDeclineTopics)
      .values({
        slug,
        label: `Topic ${slug}`,
        policy: "quote_only",
        examples: [slug],
        enabled: true,
        isDefault: false,
      })
      .onConflictDoUpdate({
        target: [agentDeclineTopics.workspaceId, agentDeclineTopics.slug],
        set: { label: `Topic ${slug}` },
      })
      .returning({ id: agentDeclineTopics.id });
    return row!.id;
  });
}

async function seedDraft(env: ContractEnv, ws: string, conversationId: string) {
  return env.scoped(ws, async (db) => {
    const [row] = await db
      .insert(assistantDraftReplies)
      .values({
        conversationId:
          conversationId as typeof assistantDraftReplies.$inferInsert.conversationId,
        content: "Here is a cited draft reply.",
        citations: [
          {
            type: "article",
            id: "article_01test",
            title: "Help article",
            url: "/portal/test/help/1-test",
          },
        ],
        confidence: 0.9,
        status: "pending",
      })
      .returning({ id: assistantDraftReplies.id });
    return row!.id;
  });
}

export const listQuillsAssistantDeclineTopics = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

let createTopicSeq = 0;

export const createQuillsAssistantDeclineTopic = fixture({
  seed: async (env) => ({
    prefix: `topic_${env
      .id("dt")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 8)}`,
  }),
  valid: (s) => ({
    body: {
      slug: `${s.prefix}_${++createTopicSeq}`,
      label: "Enterprise legal",
      policy: "always_handoff",
      examples: ["redline", "indemnification"],
      enabled: true,
    },
  }),
});

export const updateQuillsAssistantDeclineTopic = fixture({
  seed: async (env) => ({
    aId: await seedTopic(env, env.a, "contract_upd_a"),
    bId: await seedTopic(env, env.b, "contract_upd_b"),
  }),
  valid: (s) => ({
    params: { topicId: s.aId },
    body: { label: "Updated legal topic", enabled: true },
  }),
  foreign: (s) => ({ topicId: s.bId }),
});

export const deleteQuillsAssistantDeclineTopic = fixture({
  seed: async (env) => ({
    aId: await seedTopic(env, env.a, "contract_del_a"),
    bId: await seedTopic(env, env.b, "contract_del_b"),
  }),
  valid: (s) => ({ params: { topicId: s.aId } }),
  foreign: (s) => ({ topicId: s.bId }),
});

export const listQuillsAssistantEvalRuns = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const runQuillsAssistantEval = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { channel: "widget" } }),
});

export const updateQuillsAssistantChannelMode = fixture({
  seed: async (env) => {
    await env.scoped(env.a, async (db) => {
      await db.insert(aiEvalRuns).values({
        channel: "all",
        model: "deterministic-replay",
        promptHash: "0".repeat(64),
        totalCases: 6,
        passedCases: 6,
        groundingScore: 1,
        escalationScore: 1,
        declineScore: 1,
        passed: true,
        details: [],
      });
    });
    return {};
  },
  valid: () => ({
    body: { channel: "widget", mode: "auto", confidenceThreshold: 0.8 },
  }),
});

export const listQuillsConversationAssistantDrafts = fixture({
  seed: seedConversations,
  valid: (ids) => ({ params: { conversationId: ids.a.conversationId } }),
  foreign: (ids) => ({ conversationId: ids.b.conversationId }),
});

export const approveQuillsAssistantDraft = fixture({
  seed: async (env, caller) => {
    const ids = await seedConversations(env, caller);
    return {
      aId: await seedDraft(env, env.a, ids.a.conversationId),
      bId: await seedDraft(env, env.b, ids.b.conversationId),
    };
  },
  valid: (s) => ({
    params: { draftId: s.aId },
    body: { content: "Approved cited answer." },
  }),
  foreign: (s) => ({ draftId: s.bId }),
});

export const dismissQuillsAssistantDraft = fixture({
  seed: async (env, caller) => {
    const ids = await seedConversations(env, caller);
    return {
      aId: await seedDraft(env, env.a, ids.a.conversationId),
      bId: await seedDraft(env, env.b, ids.b.conversationId),
    };
  },
  valid: (s) => ({ params: { draftId: s.aId } }),
  foreign: (s) => ({ draftId: s.bId }),
});
