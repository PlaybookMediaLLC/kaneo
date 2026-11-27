import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
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
import type { AiConfig } from "../ai/config";
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
import { failedUsage, nothing, type Work } from "./shared";

// The customer agent (gap G-31): while a teammate turns it on, it answers a widget or portal
// conversation from the help center and documents. It hands off to the team with a private note
// when it cannot help or the customer asks for a person, and it can propose one feedback request
// per conversation, which the customer confirms. A conversation that a teammate owns, or that the
// agent already handed off or resolved, is left to the team.
//
// It runs on the AI SDK tool loop (ai/agent.ts). Its knowledge is searched by words and by meaning
// (retrieval.ts) before the first call, and it can search again with other words, or call a read
// tool of a connector assigned to it whose policy is "always" (no teammate is there to approve).
// The guidance rules and skills that a teammate assigned to it shape its answer.

const answer = z.object({
  reply: z.string().max(3000),
  handoff: z.enum(ASSISTANT_MODEL_HANDOFF_REASONS).nullable(),
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
const query = z.object({ query: z.string().trim().min(1).max(200) });

/** A search embedding waits at most this long; search by words does not need it. */
const EMBED_MS = 8_000;

/**
 * The text's vector for search by meaning, or null without embeddings or when the call fails.
 * After one failure the turn searches by words only, so a slow provider costs one wait.
 */
async function vectorOf(
  text: string,
  usage: UsageEntry[],
  state: { failed: boolean },
  configOverride?: AiConfig,
): Promise<Near | null> {
  const model = (configOverride ?? aiConfig())?.embeddingModel;
  if (!model || state.failed) return null;
  try {
    const result = await embed([text], EMBED_MS, configOverride);
    usage.push({
      step: "customer_agent_search",
      callType: "embedding",
      usage: result.usage,
    });
    return { values: result.vectors[0]!, model };
  } catch (error) {
    // Search by words still works; the answer is worth more than the better search.
    if (!(error instanceof AiError)) throw error;
    state.failed = true;
    usage.push(failedUsage("customer_agent_search", "embedding", error));
    return null;
  }
}

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
    if (!config.agent.enabled || !messageId) return null;
    const [message] = await db
      .select({
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
      conversation.channel !== "messenger" ||
      conversation.status !== "open" ||
      conversation.endReason === "spam" ||
      conversation.assignedAgentPrincipalId
    )
      return null;
    if (conversation.visitorPrincipalId) {
      const { principal } =
        await import("../../../database/quills/schema/auth");
      const { isSpamBlocked } = await import("../../framework/anti-spam");
      const [visitor] = await db
        .select({ blockedAt: principal.blockedAt })
        .from(principal)
        .where(eq(principal.id, conversation.visitorPrincipalId))
        .limit(1);
      if (visitor?.blockedAt) return null;
      const blocked = await isSpamBlocked(db, {
        principalId: conversation.visitorPrincipalId,
        email: conversation.visitorEmail,
      });
      if (blocked.blocked) return null;
    }
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
            eq(conversationMessages.sendStatus, "sent"),
            isNull(conversationMessages.deletedAt),
          ),
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(TRANSCRIPT)
    ).reverse();
    const guidance = await loadGuidance(db, "agent");
    const { checkAiBudget, resolveWorkspaceAiConfig } =
      await import("../budget");
    const budgetCheck = await checkAiBudget(db);
    const resolvedAiConfig = await resolveWorkspaceAiConfig(
      db,
      budgetCheck.degradedMode === "cheaper_model"
        ? budgetCheck.cheaperModel
        : null,
    );
    if (!resolvedAiConfig) return null;
    return {
      config,
      conversation,
      involvement,
      question: message.content,
      transcript,
      guidance,
      budgetCheck,
      resolvedAiConfig,
      // At most one proposed request per conversation.
      cardOffered: transcript.some((row) => row.metadata?.feedbackCard),
    };
  });
  if (!read) return nothing;
  const {
    config,
    conversation,
    involvement,
    question,
    transcript,
    budgetCheck,
    resolvedAiConfig,
  } = read;
  if (budgetCheck.degradedMode === "pause") {
    return async (db) => {
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
        (latest && latest.status !== "active")
      ) {
        return;
      }
      const now = new Date();
      if (latest) {
        await db
          .update(assistantInvolvements)
          .set({
            status: "handed_off",
            handoffReason: "capability_limit",
            endedAt: now,
          })
          .where(eq(assistantInvolvements.id, latest.id));
      } else {
        await db.insert(assistantInvolvements).values({
          conversationId: conversation.id,
          triggeredBy: "first_touch",
          status: "handed_off",
          handoffReason: "capability_limit",
          endedAt: now,
        });
      }
      await systemNotice(
        db,
        conversation.id,
        `${config.identity.name} is paused because the workspace AI budget cap was reached (${budgetCheck.reason ?? "budget_limit"}). Handing off to the team.`,
        { internal: true, event: { kind: "assistant_handoff" } },
      );
      await db
        .update(conversations)
        .set({
          waitingSince: sql`coalesce(${conversations.waitingSince}, now())`,
        })
        .where(eq(conversations.id, conversation.id));
      await recordQuillsChange(db, null, {
        type: "conversation.updated",
        entityType: "conversation",
        entityId: conversation.id,
        payload: {
          conversationId: conversation.id,
          reason: "ai_budget_paused",
        },
      });
    };
  }
  const voice = config.agent.voice;
  const knowledge = config.agent.knowledge;
  const usage: UsageEntry[] = [];
  const search = (text: string, near: Near | null) =>
    withQuillsSystemWorkspace(workspaceId, (db) =>
      publicSources(db, knowledge, text, near),
    );
  const embedding = { failed: false };
  // Load read-only connector tools in parallel with embedding the initial question.
  const [near, connectorMap] = await Promise.all([
    vectorOf(question, usage, embedding, resolvedAiConfig),
    loadConnectorTools(workspaceId, "agent"),
  ]);
  const sources = await search(question, near);
  const seen = new Map<string, Source>(
    sources.map((source) => [source.id, source]),
  );
  // Fixed before the first call: read tools an admin turned on by name for the agent
  // (connector-tools.ts `offer`). A customer cannot approve, and no teammate is here.
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
          await vectorOf(parsed.data.query, usage, embedding, resolvedAiConfig),
        );
        for (const source of found) seen.set(source.id, source);
        // Crawled pages are third-party text: inside the data fence, as in the first prompt.
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
  // A failed turn still logs what it used, so a retry counts toward the monthly limit.
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
    configOverride: resolvedAiConfig,
    role: budgetCheck.degradedMode === "cheaper_model" ? "fast" : undefined,
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
        conversationId: conversation.id,
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
          "Answer only from the sources. When they do not answer the question, use search_knowledge with other words once before you give up. When the sources still do not answer it, or the customer asks for a person, is frustrated, repeats themselves or asks for something you cannot do, set handoff to the reason and keep reply to one short sentence that a teammate will follow up.",
          read.cardOffered
            ? "Set feedback to null."
            : "When the customer asks for a new feature or reports a product problem, set feedback to a short request title and body in their words; otherwise null.",
          'Answer with one JSON object: {"reply": string, "handoff": reason or null, "feedback": {"title": string, "body": string} or null, "sourceIds": string[]}.',
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
  // The answer is JSON; one repair (a fence, text around it), then it must fit the schema.
  const repaired = text && repairJson(text);
  const parsed = answer.safeParse(repaired && JSON.parse(repaired));
  if (!parsed.success) return failed(new AiError("bad_response"));
  const reply = { value: parsed.data };
  const citations: ConversationMessageCitation[] = [...seen.values()]
    .filter((source) => reply.value.sourceIds.includes(source.id))
    .map((source) => ({
      type: source.type,
      id: source.id,
      title: source.title,
      url: "",
    }));
  const card =
    reply.value.feedback && !read.cardOffered
      ? { ...reply.value.feedback, status: "proposed" as const }
      : undefined;
  return async (db) => {
    await logUsage(db, usage);
    // A teammate may have taken or closed the conversation while the model answered.
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
    const text = reply.value.reply.trim();
    const isBudgetDraft = budgetCheck.degradedMode === "draft_mode";
    if (text) {
      const [message] = await db
        .insert(conversationMessages)
        .values({
          conversationId: conversation.id,
          principalId: null,
          senderType: "agent",
          isInternal: isBudgetDraft,
          content: isBudgetDraft ? `[AI Budget Draft]\n${text}` : text,
          citations: citations.length ? citations : null,
          metadata: {
            assistantReply: !isBudgetDraft,
            ...(isBudgetDraft && { assistantBudgetDraft: true }),
            ...(card && !isBudgetDraft && { feedbackCard: card }),
          } as never,
        })
        .returning({
          id: conversationMessages.id,
          createdAt: conversationMessages.createdAt,
        });
      if (!isBudgetDraft) {
        await db
          .update(conversations)
          .set({
            lastMessageAt: message!.createdAt,
            lastMessagePreview: preview(text),
            updatedAt: message!.createdAt,
          })
          .where(eq(conversations.id, conversation.id));
      }
      await recordQuillsChange(db, null, {
        type: isBudgetDraft ? "message.note_created" : "message.created",
        entityType: "conversation_message",
        entityId: message!.id,
        payload: { conversationId: conversation.id, source: "assistant" },
      });
    }
    await db
      .update(assistantInvolvements)
      .set({
        lastAssistantAnswerAt: now,
        sources: citations.map(({ type, id, title }) => ({
          type,
          id,
          title,
        })) as never,
        ...(reply.value.handoff && {
          status: "handed_off" as const,
          handoffReason: reply.value.handoff,
          endedAt: now,
        }),
      })
      .where(eq(assistantInvolvements.id, involvementId));
    if (reply.value.handoff) {
      // Structured handoff summary (#309): committed as an internal note with metadata.handoff
      // inside the same transaction BEFORE teammates are notified.
      const visitorLines = read.transcript
        .filter((m) => m.senderType === "visitor")
        .map((m) => m.content.trim())
        .filter(Boolean);
      const agentLines = read.transcript
        .filter((m) => m.senderType === "agent" && m.metadata?.assistantReply)
        .map((m) => m.content.trim())
        .filter(Boolean);
      const handoffData = {
        reason: reply.value.handoff,
        issueSummary: (visitorLines[0] ?? question).slice(0, 300),
        detailsAlreadyProvided: visitorLines
          .slice(-4)
          .map((l) => l.slice(0, 240)),
        stepsAlreadyTried: agentLines.slice(-3).map((l) => l.slice(0, 240)),
        suggestedNextAction:
          reply.value.handoff === "explicit_request"
            ? "Customer asked for a human teammate; respond directly using the details above without asking them to repeat."
            : "Review the customer's details and prior assistant replies, then follow up.",
      };
      const noteText = [
        `AI Handoff (${handoffData.reason})`,
        `Issue: ${handoffData.issueSummary}`,
        handoffData.detailsAlreadyProvided.length
          ? `Details already provided:\n- ${handoffData.detailsAlreadyProvided.join("\n- ")}`
          : null,
        handoffData.stepsAlreadyTried.length
          ? `Already tried:\n- ${handoffData.stepsAlreadyTried.join("\n- ")}`
          : null,
        `Next: ${handoffData.suggestedNextAction}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const [handoffNote] = await db
        .insert(conversationMessages)
        .values({
          conversationId: conversation.id,
          principalId: null,
          senderType: "agent",
          isInternal: true,
          content: noteText,
          metadata: {
            assistantHandoff: true,
            handoff: handoffData,
          } as never,
        })
        .returning({ id: conversationMessages.id });
      if (handoffNote) {
        await recordQuillsChange(db, null, {
          type: "message.note_created",
          entityType: "conversation_message",
          entityId: handoffNote.id,
          payload: {
            conversationId: conversation.id,
            reason: reply.value.handoff,
          },
        });
      }
      await systemNotice(db, conversation.id, "A teammate will reply here.", {
        event: { kind: "assistant_handoff" },
      });
      await db
        .update(conversations)
        .set({
          waitingSince: sql`coalesce(${conversations.waitingSince}, now())`,
        })
        .where(eq(conversations.id, conversation.id));
    }
  };
};
