import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  isNull,
  sql,
} from "drizzle-orm";
import {
  askKnowledgeQuestions,
  draftKnowledge,
  embeddingText,
  extractKnowledge,
  judgeSameKnowledge,
  type MatchPool,
  OPEN_STATUSES,
  routeCandidate,
  sourceTranscript,
  statusAfterPlanning,
  topicFingerprint,
  type Candidate,
  type Question,
  type TranscriptMessage,
} from "@quills/ai/teach";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import {
  assistantInvolvements,
  assistantSnippets,
} from "../../../database/quills/schema/assistant";
import { principal } from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import {
  knowledgeQuestions,
  knowledgeSources,
  knowledgeSuggestions,
} from "../../../database/quills/schema/knowledge-suggestions";
import { recordQuillsChange } from "../../events";
import { defineAiJob } from "../ai/job";
import { runCapability } from "../ai/run";
import { AiError, aiConfig, embed } from "../provider";
import { logUsage, type UsageEntry } from "../runs";
import { exactDistance, vectorParam } from "./distance";
import { nothing, type Work } from "./shared";

// "Teach the AI" (issue #275, phase 3, after Chatwoot Captain and Cossistant). When a conversation
// closes, the AI looks for one durable fact that a teammate stated. A new fact becomes a suggestion
// with up to three questions for a teammate; after the answers, a second job writes the draft that
// a teammate approves into a snippet. Matches with approved or dismissed knowledge are dropped;
// matches with an open suggestion add evidence. Provider calls run with no transaction open.

/** Below this cosine similarity two items are not compared by the judge. */
const MATCH_SIMILARITY = 0.85;
/** The judge runs on at most this many close items per candidate. */
const MAX_JUDGED = 3;
const GAP_REASONS = ["low_confidence", "capability_limit"] as const;
const MESSAGES = 100;

const author = (row: {
  senderType: string;
  principalId: string | null;
}): TranscriptMessage["author"] =>
  row.senderType === "visitor"
    ? "customer"
    : row.senderType === "agent"
      ? row.principalId
        ? "teammate"
        : "assistant"
      : "system";

type Close = {
  pool: MatchPool;
  id: string;
  title: string;
  content: string;
  similarity: number;
  /** The same topic fingerprint: a match without the judge. */
  exact: boolean;
};

/**
 * The review starts no provider call after this long. The feedback autopilot runs first in the same
 * job (at most two 60-second calls), so even a last 60-second call ends inside the 300-second lease.
 */
const REVIEW_BUDGET_MS = 90_000;
export const inTime = (deadline: number) => {
  if (Date.now() > deadline) throw new AiError("timeout");
};

/**
 * conversation.status_changed: reviews a closed conversation once (ai_knowledge_sources). It is
 * best effort: the feedback autopilot shares this job, so a provider failure or the time budget
 * skips the review instead of failing the job. The calls that succeeded are still logged, because
 * the monthly token limit counts them. Without a source row, a later close reviews it again.
 */
export const reviewClosedConversation: Work = async (workspaceId, event) => {
  const usage: UsageEntry[] = [];
  try {
    return await review(
      workspaceId,
      event,
      usage,
      Date.now() + REVIEW_BUDGET_MS,
    );
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return async (db) => {
      await logUsage(db, usage);
    };
  }
};

const review = async (
  workspaceId: string,
  event: Parameters<Work>[1],
  usage: UsageEntry[],
  deadline: number,
): ReturnType<Work> => {
  const config = aiConfig();
  if (!config) return nothing;
  const read = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    // Like the feedback autopilot: never a spam close or a teammate's test customer.
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .leftJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(
        and(
          eq(conversations.id, event.entityId as never),
          eq(conversations.status, "closed"),
          or(
            isNull(conversations.endReason),
            ne(conversations.endReason, "spam"),
          ),
          isNull(principal.testOwnerPrincipalId),
        ),
      );
    if (!conversation) return null;
    const [seen] = await db
      .select({ id: knowledgeSources.id })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.conversationId, conversation.id));
    if (seen) return null;
    const messages = await db
      .select({
        senderType: conversationMessages.senderType,
        principalId: conversationMessages.principalId,
        isInternal: conversationMessages.isInternal,
        content: conversationMessages.content,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          eq(conversationMessages.sendStatus, "sent"),
          isNull(conversationMessages.deletedAt),
        ),
      )
      // The newest messages: the teammate's answer usually comes late in a long thread.
      .orderBy(desc(conversationMessages.createdAt))
      .limit(MESSAGES);
    const [handoff] = await db
      .select({ id: assistantInvolvements.id })
      .from(assistantInvolvements)
      .where(
        and(
          eq(assistantInvolvements.conversationId, conversation.id),
          eq(assistantInvolvements.status, "handed_off"),
          inArray(assistantInvolvements.handoffReason, [...GAP_REASONS]),
        ),
      )
      .limit(1);
    return {
      conversationId: conversation.id as string,
      gap: Boolean(handoff),
      transcript: sourceTranscript(
        [...messages].reverse().map((row) => ({
          author: author(row),
          internal: row.isInternal,
          text: row.content,
        })),
      ),
    };
  });
  if (!read) return nothing;
  const { conversationId, gap, transcript } = read;
  const source = (
    outcome: (typeof knowledgeSources.$inferInsert)["outcome"],
    suggestionId?: string,
  ): typeof knowledgeSources.$inferInsert => ({
    conversationId: conversationId as never,
    outcome,
    gap,
    suggestionId: suggestionId ?? null,
  });

  if (!transcript.hasTeammateReply)
    return async (db) => {
      await db
        .insert(knowledgeSources)
        .values(source("none"))
        .onConflictDoNothing();
    };

  inTime(deadline);
  const extracted = await runCapability(extractKnowledge, transcript.text);
  usage.push(extracted.entry);
  const candidate = extracted.value.knowledge;
  if (!candidate)
    return async (db) => {
      await logUsage(db, usage);
      await db
        .insert(knowledgeSources)
        .values(source("none"))
        .onConflictDoNothing();
    };

  const { fingerprint, vector, route } = await matchCandidate(
    workspaceId,
    candidate,
    usage,
    deadline,
  );

  if (route.action === "discard")
    return async (db) => {
      await logUsage(db, usage);
      await db
        .insert(knowledgeSources)
        .values(source("discarded"))
        .onConflictDoNothing();
    };
  if (route.action === "attach")
    return async (db) => {
      await logUsage(db, usage);
      await attach(
        db,
        route.suggestionId,
        source("attached", route.suggestionId),
        gap,
      );
    };

  inTime(deadline);
  const planned = await runCapability(askKnowledgeQuestions, candidate);
  usage.push(planned.entry);
  const questions = planned.value.questions;
  const status = statusAfterPlanning(questions.length);
  // Without questions, the draft comes at once.
  if (status === "drafting") inTime(deadline);
  const draft =
    status === "drafting"
      ? await runCapability(draftKnowledge, { candidate, answers: [] })
      : null;
  if (draft) usage.push(draft.entry);

  return async (db) => {
    await logUsage(db, usage);
    const id = await openSuggestion(
      db,
      {
        status: draft ? "draft_ready" : status,
        gap,
        candidate,
        fingerprint,
        vector,
        title: draft?.value.title,
        content: draft?.value.content,
        questionCount: questions.length,
      },
      source,
    );
    if (!id) return;
    if (questions.length)
      await db.insert(knowledgeQuestions).values(
        questions.map((question: Question, position: number) => ({
          suggestionId: id,
          position,
          question: question.question,
          suggestedAnswers: question.suggestedAnswers,
        })),
      );
  };
};

/**
 * A candidate's topic fingerprint, its vector (with embeddings) and its route: discard, attach to an
 * open suggestion, or create. The judge compares it with at most MAX_JUDGED close items.
 */
export async function matchCandidate(
  workspaceId: string,
  candidate: Candidate,
  usage: UsageEntry[],
  deadline: number,
) {
  const config = aiConfig()!;
  const fingerprint = topicFingerprint(candidate.topic);
  let vector: number[] | null = null;
  if (config.embeddingModel) {
    inTime(deadline);
    const embedded = await embed([embeddingText(candidate)]);
    vector = embedded.vectors[0]!;
    usage.push({
      step: "knowledge_embedding",
      callType: "embedding",
      usage: embedded.usage,
    });
  }
  const close = await withQuillsSystemWorkspace(workspaceId, (db) =>
    closeItems(db, fingerprint, vector, config.embeddingModel),
  );
  let match: { pool: MatchPool; id: string } | null = null;
  for (const item of close.slice(0, MAX_JUDGED)) {
    // An identical topic fingerprint needs no judge.
    if (item.exact) {
      match = item;
      break;
    }
    inTime(deadline);
    const judged = await runCapability(judgeSameKnowledge, {
      candidate,
      existing: item,
    });
    usage.push(judged.entry);
    if (judged.value.same) {
      match = item;
      break;
    }
  }
  return { fingerprint, vector, route: routeCandidate(match) };
}

type Outcome = (typeof knowledgeSources.$inferInsert)["outcome"];

/**
 * Opens a suggestion with its `created` evidence row and records knowledge_suggestion.created. When
 * another job opened the same topic first, the evidence is attached to it instead; a retry that
 * already wrote drops the duplicate. The ID only for a new suggestion.
 */
export async function openSuggestion(
  db: Database,
  input: {
    status: (typeof knowledgeSuggestions.$inferInsert)["status"];
    gap: boolean;
    candidate: Candidate;
    fingerprint: string;
    vector: number[] | null;
    title?: string;
    content?: string;
    questionCount: number;
  },
  source: (
    outcome: Outcome,
    suggestionId: string,
  ) => typeof knowledgeSources.$inferInsert,
) {
  const { candidate, fingerprint, vector, gap } = input;
  const [row] = await db
    .insert(knowledgeSuggestions)
    .values({
      status: input.status,
      gap,
      topic: candidate.topic,
      topicFingerprint: fingerprint,
      candidateTitle: candidate.title,
      candidateContent: candidate.content,
      title: input.title,
      content: input.content,
      embedding: vector ? (vectorParam(vector) as never) : null,
      embeddingModel: vector ? aiConfig()!.embeddingModel : null,
      questionCount: input.questionCount,
    })
    .onConflictDoNothing()
    .returning({ id: knowledgeSuggestions.id });
  if (!row) {
    // Another job opened the same topic first: this source is evidence for it.
    const [open] = await db
      .select({ id: knowledgeSuggestions.id })
      .from(knowledgeSuggestions)
      .where(
        and(
          eq(knowledgeSuggestions.topicFingerprint, fingerprint),
          inArray(knowledgeSuggestions.status, [...OPEN_STATUSES]),
        ),
      );
    if (open) await attach(db, open.id, source("attached", open.id), gap);
    return null;
  }
  const inserted = await db
    .insert(knowledgeSources)
    .values(source("created", row.id))
    .onConflictDoNothing()
    .returning({ id: knowledgeSources.id });
  if (!inserted.length) {
    // A retry of a job that already wrote: drop the duplicate suggestion.
    await db
      .delete(knowledgeSuggestions)
      .where(eq(knowledgeSuggestions.id, row.id));
    return null;
  }
  await recordQuillsChange(db, null, {
    type: "knowledge_suggestion.created",
    entityType: "knowledge_suggestion",
    entityId: row.id,
    payload: { gap: String(gap) },
  });
  return row.id;
}

/**
 * Close items for a candidate, nearest first, across approved and dismissed suggestions, open
 * suggestions and snippets with a vector. An identical topic fingerprint counts as similarity 1,
 * so a match works without embeddings too.
 */
async function closeItems(
  db: Database,
  fingerprint: string,
  vector: number[] | null,
  model: string | null,
): Promise<Close[]> {
  const pool = sql<MatchPool>`CASE WHEN ${knowledgeSuggestions.status} = 'approved' THEN 'approved' WHEN ${knowledgeSuggestions.status} = 'dismissed' THEN 'dismissed' ELSE 'open' END`;
  const items: Close[] = (
    await db
      .select({
        id: knowledgeSuggestions.id,
        pool,
        title: sql<string>`coalesce(${knowledgeSuggestions.title}, ${knowledgeSuggestions.candidateTitle})`,
        content: sql<string>`coalesce(${knowledgeSuggestions.content}, ${knowledgeSuggestions.candidateContent})`,
        similarity: sql<number>`1`,
      })
      .from(knowledgeSuggestions)
      .where(eq(knowledgeSuggestions.topicFingerprint, fingerprint))
      .limit(MAX_JUDGED)
  ).map((row) => ({ ...row, id: row.id as string, exact: true }));
  if (vector && model) {
    const target = vectorParam(vector);
    const near = (column: unknown) =>
      sql<number>`(1 - ${exactDistance(column, target)})::float8`;
    const suggestions = await db
      .select({
        id: knowledgeSuggestions.id,
        pool,
        title: sql<string>`coalesce(${knowledgeSuggestions.title}, ${knowledgeSuggestions.candidateTitle})`,
        content: sql<string>`coalesce(${knowledgeSuggestions.content}, ${knowledgeSuggestions.candidateContent})`,
        similarity: near(knowledgeSuggestions.embedding).as("similarity"),
      })
      .from(knowledgeSuggestions)
      .where(
        and(
          isNotNull(knowledgeSuggestions.embedding),
          eq(knowledgeSuggestions.embeddingModel, model),
          sql`(1 - ${exactDistance(knowledgeSuggestions.embedding, target)}) >= ${MATCH_SIMILARITY}`,
        ),
      )
      .orderBy(sql`similarity DESC`)
      .limit(MAX_JUDGED);
    const snippets = await db
      .select({
        id: assistantSnippets.id,
        title: assistantSnippets.title,
        content: assistantSnippets.content,
        similarity: near(assistantSnippets.embedding).as("similarity"),
      })
      .from(assistantSnippets)
      .where(
        and(
          isNotNull(assistantSnippets.embedding),
          eq(assistantSnippets.embeddingModel, model),
          sql`(1 - ${exactDistance(assistantSnippets.embedding, target)}) >= ${MATCH_SIMILARITY}`,
        ),
      )
      .orderBy(sql`similarity DESC`)
      .limit(MAX_JUDGED);
    items.push(
      ...suggestions.map((row) => ({
        ...row,
        id: row.id as string,
        exact: false,
      })),
      ...snippets.map((row) => ({
        ...row,
        id: row.id as string,
        pool: "approved" as const,
        exact: false,
      })),
    );
  }
  const seen = new Set<string>();
  // Exact topics first, then the closest vectors; an item found both ways keeps its exact entry.
  return items
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) || b.similarity - a.similarity,
    )
    .filter((item) => !seen.has(item.id) && seen.add(item.id));
}

/** Adds a conversation as evidence to an open suggestion; a gap conversation marks it a gap. */
export async function attach(
  db: Database,
  suggestionId: string,
  values: typeof knowledgeSources.$inferInsert,
  gap: boolean,
) {
  const inserted = await db
    .insert(knowledgeSources)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: knowledgeSources.id });
  if (!inserted.length) return;
  const updated = await db
    .update(knowledgeSuggestions)
    .set({
      evidenceCount: sql`${knowledgeSuggestions.evidenceCount} + 1`,
      ...(gap && { gap: true }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeSuggestions.id, suggestionId),
        inArray(knowledgeSuggestions.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: knowledgeSuggestions.id });
  if (updated.length)
    await recordQuillsChange(db, null, {
      type: "knowledge_suggestion.attached",
      entityType: "knowledge_suggestion",
      entityId: suggestionId,
    });
}

/** Stores a draft once, while the suggestion still waits for it. */
async function storeDraft(
  db: Database,
  suggestionId: string,
  draft: { title: string; content: string },
) {
  const updated = await db
    .update(knowledgeSuggestions)
    .set({
      title: draft.title,
      content: draft.content,
      status: "draft_ready",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeSuggestions.id, suggestionId as never),
        eq(knowledgeSuggestions.status, "drafting"),
      ),
    )
    .returning({ id: knowledgeSuggestions.id });
  if (updated.length)
    await recordQuillsChange(db, null, {
      type: "knowledge_suggestion.drafted",
      entityType: "knowledge_suggestion",
      entityId: suggestionId,
    });
}

/** knowledge_suggestion.answered: writes the draft after the last answer or skip (ai/job.ts). */
export const draftKnowledgeSuggestion = defineAiJob({
  read: async (db, event) => {
    const [suggestion] = await db
      .select({
        id: knowledgeSuggestions.id,
        topic: knowledgeSuggestions.topic,
        title: knowledgeSuggestions.candidateTitle,
        content: knowledgeSuggestions.candidateContent,
      })
      .from(knowledgeSuggestions)
      .where(
        and(
          eq(knowledgeSuggestions.id, event.entityId as never),
          eq(knowledgeSuggestions.status, "drafting"),
        ),
      );
    if (!suggestion) return null;
    const answers = await db
      .select({
        question: knowledgeQuestions.question,
        answer: knowledgeQuestions.answer,
      })
      .from(knowledgeQuestions)
      .where(eq(knowledgeQuestions.suggestionId, suggestion.id))
      .orderBy(asc(knowledgeQuestions.position));
    return { suggestion, answers };
  },
  run: (context, ai) =>
    ai.capability(draftKnowledge, {
      candidate: context.suggestion,
      answers: context.answers,
    }),
  write: (db, context, draft) => storeDraft(db, context.suggestion.id, draft),
  // Without AI, or when the provider fails, the draft is the AI's first text: the teammate edits it
  // with the answers in view. A retry could leave the suggestion in "drafting" with no way forward.
  fallback: (db, context) =>
    storeDraft(db, context.suggestion.id, context.suggestion),
});
