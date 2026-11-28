import {
  DEFAULT_DECLINE_TOPICS,
  evaluateRetrievalGate,
  guardCustomerAgentReply,
  isExplicitHumanRequest,
  matchDeclineTopic,
  type GroundedSource,
} from "@quills/ai/customer-agent";
import { asc, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  AGENT_CHANNEL_MODES,
  agentDeclineTopics,
  aiEvalRuns,
  assistantDraftReplies,
  DECLINE_TOPIC_POLICIES,
  type EvalCaseDetail,
} from "../../database/quills/schema/agent-guardrails";
import {
  settings,
  type StoredAssistantConfig,
} from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../framework/define-route";
import { digest } from "../framework/signed";
import { findConversation, preview } from "../support/conversation-model";

const declineTopicItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  policy: z.enum(DECLINE_TOPIC_POLICIES),
  examples: z.array(z.string()),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

const topicParams = z.object({
  topicId: flexibleToTypeIdSchema("agent_decline_topic"),
});

const listDeclineTopics = defineQuillsRoute({
  method: "get",
  path: "/assistant/decline-topics",
  operationId: "listQuillsAssistantDeclineTopics",
  summary: "List customer agent declined/restricted topics",
  action: "manage_settings",
  response: z.object({ items: z.array(declineTopicItemSchema) }),
  responseDescription: "Configured decline topics",
  handler: async ({ db }) => ({
    items: await db
      .select()
      .from(agentDeclineTopics)
      .orderBy(asc(agentDeclineTopics.slug)),
  }),
});

const createDeclineTopic = defineQuillsRoute({
  method: "post",
  path: "/assistant/decline-topics",
  operationId: "createQuillsAssistantDeclineTopic",
  summary: "Create a declined/restricted topic for the customer agent",
  action: "manage_settings",
  body: z.object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9_-]+$/),
    label: z.string().trim().min(2).max(120),
    policy: z.enum(DECLINE_TOPIC_POLICIES),
    examples: z.array(z.string().trim().min(2).max(120)).max(25).default([]),
    enabled: z.boolean().default(true),
  }),
  response: declineTopicItemSchema,
  responseDescription: "The created decline topic",
  errors: { 409: "A decline topic with this slug already exists" },
  event: (_input, result) => ({
    type: "assistant_decline_topic.created",
    entityType: "agent_decline_topic",
    entityId: result.id,
    payload: { slug: result.slug, policy: result.policy },
  }),
  handler: async ({ db, body }) => {
    const [created] = await db
      .insert(agentDeclineTopics)
      .values({
        slug: body.slug,
        label: body.label,
        policy: body.policy,
        examples: body.examples,
        enabled: body.enabled,
        isDefault: false,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new HTTPException(409, {
        message: "A decline topic with this slug already exists",
      });
    }
    return created;
  },
});

const updateDeclineTopic = defineQuillsRoute({
  method: "patch",
  path: "/assistant/decline-topics/{topicId}",
  operationId: "updateQuillsAssistantDeclineTopic",
  summary: "Update a declined/restricted topic",
  action: "manage_settings",
  params: topicParams,
  body: z
    .object({
      label: z.string().trim().min(2).max(120).optional(),
      policy: z.enum(DECLINE_TOPIC_POLICIES).optional(),
      examples: z.array(z.string().trim().min(2).max(120)).max(25).optional(),
      enabled: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, "At least one field is required"),
  response: declineTopicItemSchema,
  responseDescription: "The updated decline topic",
  errors: { 404: "Decline topic not found" },
  event: ({ params }, result) => ({
    type: "assistant_decline_topic.updated",
    entityType: "agent_decline_topic",
    entityId: params.topicId,
    payload: { slug: result.slug, policy: result.policy },
  }),
  handler: async ({ db, params, body }) => {
    const [updated] = await db
      .update(agentDeclineTopics)
      .set({
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.policy !== undefined ? { policy: body.policy } : {}),
        ...(body.examples !== undefined ? { examples: body.examples } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentDeclineTopics.id, params.topicId))
      .returning();
    if (!updated) {
      throw new HTTPException(404, { message: "Decline topic not found" });
    }
    return updated;
  },
});

const deleteDeclineTopic = defineQuillsRoute({
  method: "delete",
  path: "/assistant/decline-topics/{topicId}",
  operationId: "deleteQuillsAssistantDeclineTopic",
  summary: "Delete a declined/restricted topic",
  action: "manage_settings",
  params: topicParams,
  response: z.object({ id: z.string() }),
  responseDescription: "Deleted topic ID",
  errors: { 404: "Decline topic not found" },
  event: ({ params }) => ({
    type: "assistant_decline_topic.deleted",
    entityType: "agent_decline_topic",
    entityId: params.topicId,
  }),
  handler: async ({ db, params }) => {
    const [deleted] = await db
      .delete(agentDeclineTopics)
      .where(eq(agentDeclineTopics.id, params.topicId))
      .returning({ id: agentDeclineTopics.id });
    if (!deleted) {
      throw new HTTPException(404, { message: "Decline topic not found" });
    }
    return deleted;
  },
});

const evalRunItemSchema = z.object({
  id: z.string(),
  channel: z.string(),
  model: z.string(),
  promptDigest: z.string(),
  totalCases: z.number().int(),
  passedCases: z.number().int(),
  groundingScore: z.number(),
  escalationScore: z.number(),
  declineScore: z.number(),
  passed: z.boolean(),
  details: z.array(
    z.object({
      id: z.string(),
      category: z.enum([
        "grounding",
        "escalation",
        "decline",
        "tool_allowlist",
      ]),
      passed: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
  createdAt: responseTimestamp,
});

function toEvalItem(row: typeof aiEvalRuns.$inferSelect) {
  const { promptHash, ...rest } = row;
  return { ...rest, promptDigest: promptHash };
}

/** Deterministic offline policy/grounding/escalation replay evaluation suite (#299). */
export function runDeterministicPolicyEval(
  topics: readonly (typeof DEFAULT_DECLINE_TOPICS)[number][],
): {
  totalCases: number;
  passedCases: number;
  groundingScore: number;
  escalationScore: number;
  declineScore: number;
  passed: boolean;
  details: EvalCaseDetail[];
} {
  const details: EvalCaseDetail[] = [];
  const sampleSource: GroundedSource = {
    id: "article_eval_1",
    type: "article",
    title: "Refund policy",
    excerpt: "Full refunds are available within 14 days of purchase.",
    url: "/portal/eval/help/refund-policy",
    score: 0.91,
  };
  const sourceMap = new Map([[sampleSource.id, sampleSource]]);

  // 1. Zero-source grounding block
  const gateEmpty = evaluateRetrievalGate([]);
  details.push({
    id: "grounding_zero_source",
    category: "grounding",
    passed: !gateEmpty.allowed && gateEmpty.reason === "no_supporting_source",
  });

  // 2. Fabricated citation rejected
  const fabCite = guardCustomerAgentReply({
    output: {
      reply: "Sure, we offer lifetime free upgrades.",
      handoff: null,
      confidence: 0.95,
      sourceIds: ["article_nonexistent"],
    },
    retrievedSources: sourceMap,
  });
  details.push({
    id: "grounding_fabricated_citation",
    category: "grounding",
    passed: fabCite.outcome === "handoff",
  });

  // 3. Low confidence escalates
  const lowConf = guardCustomerAgentReply({
    output: {
      reply: "Maybe 14 days.",
      handoff: null,
      confidence: 0.45,
      sourceIds: [sampleSource.id],
    },
    retrievedSources: sourceMap,
    confidenceThreshold: 0.75,
  });
  details.push({
    id: "escalation_low_confidence",
    category: "escalation",
    passed: lowConf.outcome === "handoff",
  });

  // 4. Explicit human request escalates immediately
  details.push({
    id: "escalation_human_request",
    category: "escalation",
    passed: isExplicitHumanRequest("I want to talk to a person right now"),
  });

  // 5. Quote-only decline topic blocks paraphrase
  const effectiveTopics = topics.length > 0 ? topics : DEFAULT_DECLINE_TOPICS;
  const refundMatch = matchDeclineTopic("Can I get a refund?", effectiveTopics);
  const paraphrased = guardCustomerAgentReply({
    output: {
      reply: "We usually return your money in two weeks.",
      handoff: null,
      confidence: 0.92,
      quotedExcerpt: "We return money in two weeks",
      sourceIds: [sampleSource.id],
    },
    retrievedSources: sourceMap,
    declineMatch: refundMatch,
  });
  details.push({
    id: "decline_quote_only_blocks_paraphrase",
    category: "decline",
    passed: refundMatch.matched ? paraphrased.outcome === "handoff" : true,
  });

  // 6. Quote-only decline topic allows verbatim quoted & cited answer
  const verbatim = guardCustomerAgentReply({
    output: {
      reply:
        'Our policy states: "Full refunds are available within 14 days of purchase."',
      handoff: null,
      confidence: 0.94,
      quotedExcerpt: "Full refunds are available within 14 days of purchase.",
      sourceIds: [sampleSource.id],
    },
    retrievedSources: sourceMap,
    declineMatch: refundMatch,
  });
  details.push({
    id: "decline_quote_only_allows_verbatim",
    category: "decline",
    passed:
      verbatim.outcome === "answer" &&
      verbatim.citations.length === 1 &&
      verbatim.citations[0]!.url === sampleSource.url,
  });

  const scoreFor = (cat: EvalCaseDetail["category"]) => {
    const subset = details.filter((d) => d.category === cat);
    if (subset.length === 0) return 1;
    return subset.filter((d) => d.passed).length / subset.length;
  };
  const passedCases = details.filter((d) => d.passed).length;
  const groundingScore = scoreFor("grounding");
  const escalationScore = scoreFor("escalation");
  const declineScore = scoreFor("decline");

  return {
    totalCases: details.length,
    passedCases,
    groundingScore,
    escalationScore,
    declineScore,
    passed: passedCases === details.length,
    details,
  };
}

const listEvalRuns = defineQuillsRoute({
  method: "get",
  path: "/assistant/eval-runs",
  operationId: "listQuillsAssistantEvalRuns",
  summary: "List recent AI customer agent evaluation runs",
  action: "manage_settings",
  response: z.object({ items: z.array(evalRunItemSchema) }),
  responseDescription: "Recent evaluation runs",
  handler: async ({ db }) => {
    const rows = await db
      .select()
      .from(aiEvalRuns)
      .orderBy(desc(aiEvalRuns.createdAt), desc(aiEvalRuns.id))
      .limit(20);
    return { items: rows.map(toEvalItem) };
  },
});

const runEval = defineQuillsRoute({
  method: "post",
  path: "/assistant/eval-runs",
  operationId: "runQuillsAssistantEval",
  summary: "Run the customer agent policy & grounding evaluation suite",
  description:
    "Executes deterministic grounding, escalation, and decline-topic replay checks against the workspace's active policy configuration and records the result to gate `auto` mode.",
  action: "manage_settings",
  body: z.object({
    channel: z.enum(["all", "messenger", "email", "widget"]),
  }),
  response: evalRunItemSchema,
  responseDescription: "Recorded evaluation run",
  event: (_input, result) => ({
    type: "assistant_eval.recorded",
    entityType: "ai_eval_run",
    entityId: result.id,
    payload: { passed: String(result.passed), channel: result.channel },
  }),
  handler: async ({ db, body }) => {
    const topics = await db.select().from(agentDeclineTopics);
    const result = runDeterministicPolicyEval(
      topics.map((t) => ({
        slug: t.slug,
        label: t.label,
        policy: t.policy,
        examples: t.examples,
        enabled: t.enabled,
      })),
    );
    const promptHash = digest(
      JSON.stringify(
        topics
          .map((t) => [t.slug, t.policy, t.enabled, t.examples])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
    );
    const [row] = await db
      .insert(aiEvalRuns)
      .values({
        channel: body.channel,
        model: "deterministic-replay",
        promptHash,
        totalCases: result.totalCases,
        passedCases: result.passedCases,
        groundingScore: result.groundingScore,
        escalationScore: result.escalationScore,
        declineScore: result.declineScore,
        passed: result.passed,
        details: result.details,
      })
      .returning();
    if (!row) throw new Error("Failed to record eval run");
    return toEvalItem(row);
  },
});

const updateChannelMode = defineQuillsRoute({
  method: "patch",
  path: "/assistant/channels",
  operationId: "updateQuillsAssistantChannelMode",
  summary: "Set customer agent mode (off, draft, or auto) for a channel",
  description:
    "Switching a channel to `auto` requires a passing AI evaluation run for this workspace; otherwise returns 409.",
  action: "manage_settings",
  body: z.object({
    channel: z.enum(["messenger", "email", "widget"]),
    mode: z.enum(AGENT_CHANNEL_MODES),
    confidenceThreshold: z.number().min(0.5).max(0.99).optional(),
  }),
  response: z.object({
    channel: z.enum(["messenger", "email", "widget"]),
    mode: z.enum(AGENT_CHANNEL_MODES),
    confidenceThreshold: z.number(),
  }),
  responseDescription: "Updated channel agent mode",
  errors: {
    409: "Auto mode requires a passing AI evaluation run first",
  },
  event: ({ body }) => ({
    type: "settings.assistant_updated",
    entityType: "settings",
    entityId: `channel:${body.channel}`,
    payload: { channel: body.channel, mode: body.mode },
  }),
  handler: async ({ db, body }) => {
    if (body.mode === "auto") {
      const [latestEval] = await db
        .select({ passed: aiEvalRuns.passed })
        .from(aiEvalRuns)
        .orderBy(desc(aiEvalRuns.createdAt), desc(aiEvalRuns.id))
        .limit(1);
      if (!latestEval?.passed) {
        throw new HTTPException(409, {
          message:
            "Run and pass the customer agent evaluation suite before enabling auto mode",
        });
      }
    }

    const [row] = await db
      .select({ config: settings.assistantConfig })
      .from(settings)
      .limit(1);
    const existing = (row?.config ?? {}) as StoredAssistantConfig & {
      agents?: {
        agent?: {
          channels?: Record<
            string,
            { mode: string; confidenceThreshold: number }
          >;
        };
      };
    };
    const threshold = body.confidenceThreshold ?? 0.75;
    const nextConfig = {
      ...existing,
      agents: {
        ...existing.agents,
        agent: {
          ...existing.agents?.agent,
          channels: {
            ...existing.agents?.agent?.channels,
            [body.channel]: {
              mode: body.mode,
              confidenceThreshold: threshold,
            },
          },
        },
      },
    };
    await db.update(settings).set({
      assistantConfig: nextConfig as StoredAssistantConfig,
      assistantConfigRevision: sql`${settings.assistantConfigRevision} + 1`,
    });
    return {
      channel: body.channel,
      mode: body.mode,
      confidenceThreshold: threshold,
    };
  },
});

const draftItemSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  content: z.string(),
  citations: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
      title: z.string(),
      url: z.string(),
    }),
  ),
  confidence: z.number(),
  status: z.enum(["pending", "sent", "dismissed"]),
  sentMessageId: z.string().nullable(),
  createdAt: responseTimestamp,
  reviewedAt: nullableResponseTimestamp,
});

const listConversationDrafts = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/assistant-drafts",
  operationId: "listQuillsConversationAssistantDrafts",
  summary: "List isolated AI draft replies for a conversation",
  action: "read",
  params: z.object({
    conversationId: flexibleToTypeIdSchema("conversation"),
  }),
  response: z.object({ items: z.array(draftItemSchema) }),
  responseDescription: "AI draft replies awaiting teammate review",
  errors: { 404: "Conversation not found" },
  handler: async ({ db, params }) => {
    const conv = await findConversation(db, params.conversationId);
    const rows = await db
      .select()
      .from(assistantDraftReplies)
      .where(eq(assistantDraftReplies.conversationId, conv.id))
      .orderBy(desc(assistantDraftReplies.createdAt))
      .limit(20);
    return { items: rows };
  },
});

const approveDraft = defineQuillsRoute({
  method: "post",
  path: "/assistant-drafts/{draftId}/approve",
  operationId: "approveQuillsAssistantDraft",
  summary: "Approve and send an AI draft reply to the customer",
  action: "update",
  params: z.object({
    draftId: flexibleToTypeIdSchema("assistant_draft_reply"),
  }),
  body: z.object({
    content: z.string().trim().min(1).max(4000),
  }),
  response: z.object({
    draft: draftItemSchema,
    messageId: z.string(),
  }),
  responseDescription: "The approved draft and created customer message ID",
  errors: {
    404: "Draft not found",
    409: "Draft was already reviewed",
  },
  event: (_input, result) => ({
    type: "assistant_draft.sent",
    entityType: "assistant_draft_reply",
    entityId: result.draft.id,
    payload: {
      conversationId: result.draft.conversationId,
      messageId: result.messageId,
    },
  }),
  handler: async ({ db, actor, params, body }) => {
    const [draft] = await db
      .select()
      .from(assistantDraftReplies)
      .where(eq(assistantDraftReplies.id, params.draftId))
      .for("update");
    if (!draft) throw new HTTPException(404, { message: "Draft not found" });
    if (draft.status !== "pending") {
      throw new HTTPException(409, { message: "Draft was already reviewed" });
    }
    const content = body.content;
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: draft.conversationId,
        principalId: actor.principalId,
        senderType: "agent",
        content,
        citations: draft.citations.length ? draft.citations : null,
        metadata: { assistantReply: true },
      })
      .returning({
        id: conversationMessages.id,
        createdAt: conversationMessages.createdAt,
      });
    await db
      .update(conversations)
      .set({
        lastMessageAt: message!.createdAt,
        lastMessagePreview: preview(content),
        updatedAt: message!.createdAt,
      })
      .where(eq(conversations.id, draft.conversationId));
    const [updated] = await db
      .update(assistantDraftReplies)
      .set({
        content,
        status: "sent",
        sentMessageId: message!.id,
        reviewedByPrincipalId: actor.principalId,
        reviewedAt: new Date(),
      })
      .where(eq(assistantDraftReplies.id, draft.id))
      .returning();
    return { draft: updated!, messageId: message!.id };
  },
});

const dismissDraft = defineQuillsRoute({
  method: "post",
  path: "/assistant-drafts/{draftId}/dismiss",
  operationId: "dismissQuillsAssistantDraft",
  summary: "Dismiss an AI draft reply without sending it to the customer",
  action: "update",
  params: z.object({
    draftId: flexibleToTypeIdSchema("assistant_draft_reply"),
  }),
  response: draftItemSchema,
  responseDescription: "The dismissed draft",
  errors: {
    404: "Draft not found",
    409: "Draft was already reviewed",
  },
  event: ({ params }, result) => ({
    type: "assistant_draft.dismissed",
    entityType: "assistant_draft_reply",
    entityId: params.draftId,
    payload: { conversationId: result.conversationId },
  }),
  handler: async ({ db, actor, params }) => {
    const [draft] = await db
      .select()
      .from(assistantDraftReplies)
      .where(eq(assistantDraftReplies.id, params.draftId))
      .for("update");
    if (!draft) throw new HTTPException(404, { message: "Draft not found" });
    if (draft.status !== "pending") {
      throw new HTTPException(409, { message: "Draft was already reviewed" });
    }
    const [updated] = await db
      .update(assistantDraftReplies)
      .set({
        status: "dismissed",
        reviewedByPrincipalId: actor.principalId,
        reviewedAt: new Date(),
      })
      .where(eq(assistantDraftReplies.id, draft.id))
      .returning();
    return updated!;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listDeclineTopics)
  .openapi(...createDeclineTopic)
  .openapi(...updateDeclineTopic)
  .openapi(...deleteDeclineTopic)
  .openapi(...listEvalRuns)
  .openapi(...runEval)
  .openapi(...updateChannelMode)
  .openapi(...listConversationDrafts)
  .openapi(...approveDraft)
  .openapi(...dismissDraft);
