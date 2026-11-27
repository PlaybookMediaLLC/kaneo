import {
  buildHandoffSummary,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_HANDOFF_REPLY,
  evaluateRetrievalGate,
  guardCustomerAgentReply,
  isExplicitHumanRequest,
  matchDeclineTopic,
  type DeclineTopicRule,
  type GroundedSource,
} from "@quills/ai/customer-agent";
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import {
  agentDeclineTopics,
  assistantDraftReplies,
  type AgentChannelMode,
} from "../../../database/quills/schema/agent-guardrails";
import {
  ASSISTANT_MODEL_HANDOFF_REASONS,
  assistantInvolvements,
} from "../../../database/quills/schema/assistant";
import { settings } from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import type { ConversationMessageCitation } from "../../../database/quills/types";
import { recordQuillsChange } from "../../events";
import { preview, systemNotice } from "../../support/conversation-model";
import { runToolLoop, type LoopTool } from "../ai/agent";
import { repairJson } from "../ai/repair";
import { checkArgs } from "../connector-tools";
import { AiError, aiConfig, embed, untrusted } from "../provider";
import { logUsage, type UsageEntry } from "../runs";
import { readConfig } from "../settings";
import {
  callConnector,
  connectorBudget,
  digest,
  loadConnectorTools,
} from "./connector-calls";
import {
  formatSources,
  publicSources,
  type Near,
  type Source,
} from "./retrieval";
import { guidanceLines, loadGuidance } from "./agent-guidance";
import { failedUsage, nothing, type Work, type Write } from "./shared";

// The customer agent (#299):
// - Enforces per-channel mode (`off | draft | auto`), confidence threshold, and 5 AI replies/hour cap.
// - Explicit human requests and `always_handoff` decline topics escalate immediately with zero LLM call.
// - Hard retrieval gate blocks answering when zero qualifying sources exist.
// - Post-LLM citation/confidence/quote-only guard guarantees every shipped answer is cited, confident,
//   and verbatim-quoted on `quote_only` topics (pricing, refunds, policies, contract terms).
// - `draft` mode writes to isolated `quills.assistant_draft_replies` so unapproved drafts never leak.

const answer = z.object({
  reply: z.string().max(3000),
  handoff: z.enum(ASSISTANT_MODEL_HANDOFF_REASONS).nullable(),
  confidence: z.number().min(0).max(1).default(0.8),
  quotedExcerpt: z.string().max(600).nullable().optional(),
  feedback: z
    .object({
      title: z.string().trim().min(3).max(120),
      body: z.string().trim().max(2000),
    })
    .nullable(),
  sourceIds: z.array(z.string()).max(10),
});
const TRANSCRIPT = 12;
const MAX_STEPS = 3;
const MAX_AI_REPLIES_PER_HOUR = 5;
const query = z.object({ query: z.string().trim().min(1).max(200) });

/** A search embedding waits at most this long; search by words does not need it. */
const EMBED_MS = 8_000;

type ChannelSettings = {
  mode: AgentChannelMode;
  confidenceThreshold: number;
};

function resolveChannelSettings(
  rawConfig: unknown,
  channelKey: "messenger" | "email" | "widget",
  legacyEnabled: boolean,
): ChannelSettings {
  const stored = (
    rawConfig as {
      agents?: {
        agent?: {
          channels?: Partial<
            Record<
              string,
              { mode?: AgentChannelMode; confidenceThreshold?: number }
            >
          >;
        };
      };
    } | null
  )?.agents?.agent?.channels?.[channelKey];
  if (stored?.mode) {
    return {
      mode: stored.mode,
      confidenceThreshold:
        typeof stored.confidenceThreshold === "number"
          ? stored.confidenceThreshold
          : DEFAULT_CONFIDENCE_THRESHOLD,
    };
  }
  // Backward compatibility: workspaces without explicit channel mode inherit legacy agent.enabled.
  return {
    mode: legacyEnabled ? "auto" : "off",
    confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  };
}

async function vectorOf(
  text: string,
  usage: UsageEntry[],
  state: { failed: boolean },
): Promise<Near | null> {
  const model = aiConfig()?.embeddingModel;
  if (!model || state.failed) return null;
  try {
    const result = await embed([text], EMBED_MS);
    usage.push({
      step: "customer_agent_search",
      callType: "embedding",
      usage: result.usage,
    });
    return { values: result.vectors[0]!, model };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    state.failed = true;
    usage.push(failedUsage("customer_agent_search", "embedding", error));
    return null;
  }
}

const toGrounded = (source: Source): GroundedSource => ({
  id: source.id,
  type: source.type,
  title: source.title,
  excerpt: source.excerpt,
  url: source.url ?? "",
  score: source.score,
});

/** conversation.created and message.created: answers the customer's newest message. */
export const answerCustomer: Work = async (workspaceId, event) => {
  const payload = event.payload as Record<string, string>;
  const messageId =
    event.type === "conversation.created" ? payload.messageId : event.entityId;
  const read = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [row] = await db
      .select({ config: settings.assistantConfig })
      .from(settings)
      .limit(1);
    const config = readConfig(row!.config);
    if (!messageId) return null;
    const [message] = await db
      .select({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        senderType: conversationMessages.senderType,
        content: conversationMessages.content,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, messageId as never));
    if (message?.senderType !== "visitor" || !message.conversationId)
      return null;
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId));
    if (
      !conversation ||
      conversation.status !== "open" ||
      conversation.assignedAgentPrincipalId
    )
      return null;

    const channelKey: "messenger" | "email" | "widget" =
      conversation.channel === "email"
        ? "email"
        : conversation.source === "widget"
          ? "widget"
          : "messenger";
    const channelSettings = resolveChannelSettings(
      row!.config,
      channelKey,
      config.agent.enabled,
    );
    if (channelSettings.mode === "off") return null;

    const [involvement] = await db
      .select({
        id: assistantInvolvements.id,
        status: assistantInvolvements.status,
      })
      .from(assistantInvolvements)
      .where(eq(assistantInvolvements.conversationId, conversation.id))
      .orderBy(desc(assistantInvolvements.createdAt))
      .limit(1);
    if (involvement && involvement.status !== "active") return null;

    // Count AI replies sent to this customer across conversations in the past hour (5/hr cap).
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const [recentAi] = await db
      .select({ n: count() })
      .from(conversationMessages)
      .innerJoin(
        conversations,
        eq(conversations.id, conversationMessages.conversationId),
      )
      .where(
        and(
          eq(conversations.visitorPrincipalId, conversation.visitorPrincipalId),
          sql`coalesce(${conversationMessages.metadata}->>'assistantReply', 'false') = 'true'`,
          gte(conversationMessages.createdAt, oneHourAgo),
        ),
      );

    const declineTopicRows = await db
      .select({
        slug: agentDeclineTopics.slug,
        label: agentDeclineTopics.label,
        policy: agentDeclineTopics.policy,
        examples: agentDeclineTopics.examples,
        enabled: agentDeclineTopics.enabled,
      })
      .from(agentDeclineTopics);

    const transcript = (
      await db
        .select({
          senderType: conversationMessages.senderType,
          content: conversationMessages.content,
          metadata: conversationMessages.metadata,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.isInternal, false),
            isNull(conversationMessages.deletedAt),
          ),
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(TRANSCRIPT)
    ).reverse();
    const guidance = await loadGuidance(db, "agent");
    return {
      config,
      channelSettings,
      conversation,
      involvement,
      triggerMessageId: message.id,
      question: message.content,
      transcript,
      guidance,
      recentAiReplies: recentAi?.n ?? 0,
      declineTopics: declineTopicRows as DeclineTopicRule[],
      cardOffered: transcript.some((r) => r.metadata?.feedbackCard),
    };
  });
  if (!read) return nothing;
  const {
    config,
    channelSettings,
    conversation,
    involvement,
    triggerMessageId,
    question,
    transcript,
    recentAiReplies,
    declineTopics,
  } = read;

  const usage: UsageEntry[] = [];
  const attemptedSteps: string[] = [];

  const commitOutcome =
    (decision: {
      outcome: "answer" | "handoff";
      reply: string;
      citations: ConversationMessageCitation[];
      confidence: number | null;
      handoffReason?: string;
      card?: { title: string; body: string; status: "proposed" };
      sourcesConsulted: Array<{ id: string; title: string; url: string }>;
    }): Write =>
    async (db) => {
      if (usage.length > 0) await logUsage(db, usage);
      const [current] = await db
        .select({
          status: conversations.status,
          assignee: conversations.assignedAgentPrincipalId,
        })
        .from(conversations)
        .where(eq(conversations.id, conversation.id))
        .for("update");
      const [latest] = await db
        .select({
          id: assistantInvolvements.id,
          status: assistantInvolvements.status,
        })
        .from(assistantInvolvements)
        .where(eq(assistantInvolvements.conversationId, conversation.id))
        .orderBy(desc(assistantInvolvements.createdAt))
        .limit(1);
      if (
        current?.status !== "open" ||
        current.assignee ||
        latest?.id !== involvement?.id ||
        (latest && latest.status !== "active")
      )
        return;

      const now = new Date();
      const involvementId =
        involvement?.id ??
        (
          await db
            .insert(assistantInvolvements)
            .values({
              conversationId: conversation.id,
              triggeredBy: "first_touch",
            })
            .returning({ id: assistantInvolvements.id })
        )[0]!.id;

      // Draft mode: write answers to the isolated assistant_draft_replies table so unapproved text
      // can NEVER appear in customer-facing conversation_messages queries.
      if (decision.outcome === "answer" && channelSettings.mode === "draft") {
        const [draft] = await db
          .insert(assistantDraftReplies)
          .values({
            conversationId: conversation.id,
            triggerMessageId,
            content: decision.reply,
            citations: decision.citations,
            confidence: decision.confidence ?? 0,
            status: "pending",
          })
          .returning({ id: assistantDraftReplies.id });
        await db
          .update(assistantInvolvements)
          .set({
            lastAssistantAnswerAt: now,
            sources: decision.citations.map(({ type, id, title }) => ({
              type,
              id,
              title,
            })) as never,
          })
          .where(eq(assistantInvolvements.id, involvementId));
        await recordQuillsChange(db, null, {
          type: "assistant_draft.created",
          entityType: "assistant_draft_reply",
          entityId: draft!.id,
          payload: { conversationId: conversation.id },
        });
        return;
      }

      const text = decision.reply.trim();
      if (text) {
        const [message] = await db
          .insert(conversationMessages)
          .values({
            conversationId: conversation.id,
            principalId: null,
            senderType: "agent",
            content: text,
            citations: decision.citations.length ? decision.citations : null,
            metadata: {
              assistantReply: true,
              ...(decision.card && { feedbackCard: decision.card }),
            },
          })
          .returning({
            id: conversationMessages.id,
            createdAt: conversationMessages.createdAt,
          });
        await db
          .update(conversations)
          .set({
            lastMessageAt: message!.createdAt,
            lastMessagePreview: preview(text),
            updatedAt: message!.createdAt,
          })
          .where(eq(conversations.id, conversation.id));
        await recordQuillsChange(db, null, {
          type: "message.created",
          entityType: "conversation_message",
          entityId: message!.id,
          payload: { conversationId: conversation.id, source: "assistant" },
        });
      }

      await db
        .update(assistantInvolvements)
        .set({
          lastAssistantAnswerAt: now,
          sources: decision.citations.map(({ type, id, title }) => ({
            type,
            id,
            title,
          })) as never,
          ...(decision.outcome === "handoff" && {
            status: "handed_off" as const,
            handoffReason: (decision.handoffReason ?? "cannot_answer") as never,
            endedAt: now,
          }),
        })
        .where(eq(assistantInvolvements.id, involvementId));

      if (decision.outcome === "handoff") {
        const { note } = buildHandoffSummary({
          agentName: config.identity.name,
          customerQuestion: question,
          reason: decision.handoffReason ?? "cannot_answer",
          confidence: decision.confidence,
          attemptedSteps,
          sourcesConsulted: decision.sourcesConsulted,
        });
        await systemNotice(db, conversation.id, note, {
          internal: true,
          event: { kind: "assistant_handoff" },
        });
        await systemNotice(db, conversation.id, "A teammate will reply here.", {
          event: { kind: "assistant_handoff" },
        });
        await db
          .update(conversations)
          .set({
            waitingSince: sql`coalesce(${conversations.waitingSince}, now())`,
          })
          .where(eq(conversations.id, conversation.id));
        await recordQuillsChange(db, null, {
          type: "conversation.handed_off",
          entityType: "conversation",
          entityId: conversation.id,
          payload: { reason: decision.handoffReason ?? "cannot_answer" },
        });
      }
    };

  // Pre-LLM Guard 1: Per-customer hourly AI reply cap (5/hr).
  if (recentAiReplies >= MAX_AI_REPLIES_PER_HOUR) {
    attemptedSteps.push(
      `Customer reached hourly AI reply limit (${MAX_AI_REPLIES_PER_HOUR}/hr)`,
    );
    return commitOutcome({
      outcome: "handoff",
      reply:
        "I've connected you with our team so a teammate can help directly.",
      citations: [],
      confidence: null,
      handoffReason: "rate_limit",
      sourcesConsulted: [],
    });
  }

  // Pre-LLM Guard 2: Explicit request for a human -> immediate deterministic handoff.
  if (isExplicitHumanRequest(question)) {
    attemptedSteps.push("Customer explicitly requested a human teammate");
    return commitOutcome({
      outcome: "handoff",
      reply: "I've connected you with our team.",
      citations: [],
      confidence: null,
      handoffReason: "customer_requested",
      sourcesConsulted: [],
    });
  }

  // Pre-LLM Guard 3: Declined topic policy (`always_handoff` escalates without calling LLM).
  const declineMatch = matchDeclineTopic(question, declineTopics);
  if (declineMatch.matched) {
    attemptedSteps.push(
      `Matched restricted topic "${declineMatch.topic.label}" (${declineMatch.topic.policy})`,
    );
    if (declineMatch.topic.policy === "always_handoff") {
      return commitOutcome({
        outcome: "handoff",
        reply: DEFAULT_HANDOFF_REPLY,
        citations: [],
        confidence: null,
        handoffReason: "restricted_topic",
        sourcesConsulted: [],
      });
    }
  }

  if (!aiConfig()) return nothing;

  const voice = config.agent.voice;
  const knowledge = config.agent.knowledge;
  const search = (text: string, near: Near | null) =>
    withQuillsSystemWorkspace(workspaceId, (db) =>
      publicSources(db, knowledge, text, near),
    );
  const embedding = { failed: false };
  const [near, connectorMap] = await Promise.all([
    vectorOf(question, usage, embedding),
    loadConnectorTools(workspaceId, "agent"),
  ]);
  const sources = await search(question, near);
  attemptedSteps.push(
    `Searched knowledge base (${sources.length} candidate source${sources.length === 1 ? "" : "s"})`,
  );

  // Pre-LLM Guard 4: Hard retrieval gate — never ask the LLM to answer from memory!
  const gate = evaluateRetrievalGate(sources.map(toGrounded));
  if (!gate.allowed && connectorMap.size === 0) {
    attemptedSteps.push(
      "Retrieval gate blocked answering: zero qualifying sources",
    );
    return commitOutcome({
      outcome: "handoff",
      reply: DEFAULT_HANDOFF_REPLY,
      citations: [],
      confidence: 0,
      handoffReason: "cannot_answer",
      sourcesConsulted: [],
    });
  }

  const seen = new Map<string, GroundedSource>(
    sources.map((source) => [source.id, toGrounded(source)]),
  );
  const connectorTools = [...connectorMap.values()];
  const budget = connectorBudget();
  const repeats = new Map<string, number>();
  const tools: LoopTool[] = [
    {
      name: "search_knowledge",
      description:
        "Search the help center and the team's answers again, for example with other words. Returns titles and excerpts with their IDs.",
      parameters: z.toJSONSchema(query),
      run: async (args) => {
        const parsed = query.safeParse(args);
        if (!parsed.success) return "Failed: the arguments are not valid.";
        const found = await search(
          parsed.data.query,
          await vectorOf(parsed.data.query, usage, embedding),
        );
        attemptedSteps.push(
          `Re-searched knowledge base for "${parsed.data.query}" (${found.length} hit${found.length === 1 ? "" : "s"})`,
        );
        for (const source of found) seen.set(source.id, toGrounded(source));
        return untrusted("sources", formatSources(found));
      },
    },
    ...connectorTools.map((tool): LoopTool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      run: async (args) => {
        const checked = checkArgs(tool, args);
        if (!checked)
          return "Failed: the arguments do not fit the tool's input schema.";
        const same = digest([tool.name, checked]);
        repeats.set(same, (repeats.get(same) ?? 0) + 1);
        const outcome = await budget((timeoutMs) =>
          callConnector(
            workspaceId,
            tool,
            checked,
            {
              key: `agent:${messageId}:${same}:${repeats.get(same)}`,
              principalId: conversation.visitorPrincipalId as string,
              conversationId: conversation.id,
              agent: "agent",
            },
            timeoutMs,
          ),
        );
        if (!outcome)
          return "Denied: this conversation reached its limit of tool calls.";
        return "duplicate" in outcome
          ? "Skipped: this call already ran in an earlier attempt."
          : outcome.content;
      },
    })),
  ];

  const failed = async (error: unknown): Promise<never> => {
    await withQuillsSystemWorkspace(workspaceId, (db) =>
      logUsage(db, [
        ...usage,
        failedUsage("customer_agent", "chat_completion", error),
      ]),
    );
    throw error;
  };

  const text = await runToolLoop({
    json: true,
    tools,
    maxSteps: MAX_STEPS,
    maxCallsPerStep: 3,
    toolCallConcurrency: 3,
    maxOutputTokens: 1024,
    timeoutMs: 150_000,
    stepTimeoutMs: 50_000,
    onStep: (step) =>
      usage.push({
        step: "customer_agent",
        callType: "chat_completion",
        usage: step,
      }),
    onDenied: () => undefined,
    messages: [
      {
        role: "system",
        content: [
          `You are ${config.identity.name}, the support assistant in a product's help widget. Tone: ${voice.tone}. Length: ${voice.responseLength}.`,
          config.agent.productDescription &&
            `The product: ${config.agent.productDescription}`,
          voice.additionalInstructions,
          "Answer ONLY from the provided sources and always include every cited source ID in sourceIds. Never invent facts or answer from memory. When sources do not answer the question, or the customer asks for a person, is frustrated, repeats themselves, or asks for something you cannot do, set handoff to the reason.",
          declineMatch.matched
            ? `STRICT QUOTE-ONLY POLICY (${declineMatch.topic.label}): You MUST quote the exact wording verbatim from a provided source in quotedExcerpt and never paraphrase or extrapolate. If no source states the exact answer verbatim, set handoff to "cannot_answer".`
            : "",
          read.cardOffered
            ? "Set feedback to null."
            : "When the customer asks for a new feature or reports a product problem, set feedback to a short request title and body in their words; otherwise null.",
          'Answer with one JSON object: {"reply": string, "handoff": reason or null, "confidence": number (0..1), "quotedExcerpt": string or null, "feedback": {"title": string, "body": string} or null, "sourceIds": string[]}.',
          ...guidanceLines(read.guidance),
        ]
          .filter(Boolean)
          .join("\n"),
      },
      { role: "system", content: untrusted("sources", formatSources(sources)) },
      {
        role: "user",
        content: untrusted(
          "conversation",
          transcript
            .map(
              (row) =>
                `${row.senderType === "visitor" ? "Customer" : "Team"}: ${row.content}`,
            )
            .join("\n"),
        ),
      },
    ],
  }).catch(failed);

  const repaired = text && repairJson(text);
  const parsed = answer.safeParse(repaired && JSON.parse(repaired));
  if (!parsed.success) return failed(new AiError("bad_response"));

  // Post-LLM Guard: enforce citations, confidence threshold, and quote-only verbatim policy.
  const guarded = guardCustomerAgentReply({
    output: parsed.data,
    retrievedSources: seen,
    confidenceThreshold: channelSettings.confidenceThreshold,
    declineMatch,
  });

  if (guarded.outcome === "handoff") {
    attemptedSteps.push(`Post-check escalated (${guarded.guardTriggered})`);
  }

  const card =
    guarded.outcome === "answer" && parsed.data.feedback && !read.cardOffered
      ? { ...parsed.data.feedback, status: "proposed" as const }
      : undefined;

  return commitOutcome({
    outcome: guarded.outcome,
    reply: guarded.reply,
    citations: guarded.citations,
    confidence: guarded.confidence,
    handoffReason:
      guarded.outcome === "handoff" ? guarded.handoffReason : undefined,
    card,
    sourcesConsulted: [...seen.values()].map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
    })),
  });
};
