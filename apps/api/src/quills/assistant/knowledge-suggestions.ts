import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  afterTurn,
  OPEN_STATUSES,
  SUGGESTION_STATUSES,
} from "@quills/ai/teach";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  ASSISTANT_SNIPPET_AUDIENCES,
  assistantSnippets,
} from "../../database/quills/schema/assistant";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import {
  knowledgeQuestions,
  knowledgeSources,
  knowledgeSuggestions,
} from "../../database/quills/schema/knowledge-suggestions";
import { someField } from "../feedback/schemas";
import { defineQuillsRoute, type Database } from "../framework/define-route";

// "Teach the AI" (issue #275, phase 3): the review list of knowledge that the AI found in closed
// conversations (engine/teach.ts). A teammate answers the AI's questions, edits the draft, and
// approves it into an assistant snippet (team audience unless chosen) or dismisses it. A dismissed
// topic is never suggested again.

const MAX_SNIPPETS = 500;
const LIST_LIMIT = 200;
const params = z.object({ suggestionId: z.string().uuid() });
const questionSchema = z.object({
  position: z.number().int(),
  question: z.string(),
  suggestedAnswers: z.array(z.string()),
  answer: z.string().nullable(),
  skipped: z.boolean(),
});
const suggestionSchema = z.object({
  id: z.string(),
  status: z.enum(SUGGESTION_STATUSES),
  gap: z
    .boolean()
    .describe(
      "The customer agent could not answer this; such suggestions rank first.",
    ),
  topic: z.string(),
  candidateTitle: z.string(),
  candidateContent: z.string(),
  title: z
    .string()
    .nullable()
    .describe("The draft title, once the questions are done."),
  content: z
    .string()
    .nullable()
    .describe("The draft content, once the questions are done."),
  evidenceCount: z
    .number()
    .int()
    .describe("Closed conversations that support it."),
  questionCount: z.number().int(),
  stepIndex: z.number().int().describe("Questions answered or skipped so far."),
  approvedSnippetId: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const detailSchema = suggestionSchema.extend({
  questions: z.array(questionSchema),
});
const columns = {
  id: knowledgeSuggestions.id,
  status: knowledgeSuggestions.status,
  gap: knowledgeSuggestions.gap,
  topic: knowledgeSuggestions.topic,
  candidateTitle: knowledgeSuggestions.candidateTitle,
  candidateContent: knowledgeSuggestions.candidateContent,
  title: knowledgeSuggestions.title,
  content: knowledgeSuggestions.content,
  evidenceCount: knowledgeSuggestions.evidenceCount,
  questionCount: knowledgeSuggestions.questionCount,
  stepIndex: knowledgeSuggestions.stepIndex,
  approvedSnippetId: knowledgeSuggestions.approvedSnippetId,
  createdAt: knowledgeSuggestions.createdAt,
  updatedAt: knowledgeSuggestions.updatedAt,
};
const fields = {
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(2000),
};
const errors = {
  404: "Suggestion not found",
  409: "The suggestion is not in that step",
};
type SuggestionId = z.output<typeof params>["suggestionId"];

/** The suggestion, locked for the rest of the transaction; 404 when it is not in this workspace. */
async function findSuggestion(db: Database, id: SuggestionId) {
  const [row] = await db
    .select(columns)
    .from(knowledgeSuggestions)
    .where(eq(knowledgeSuggestions.id, id))
    .for("update");
  if (!row) throw new HTTPException(404, { message: "Suggestion not found" });
  return row;
}
const conflict = (message = "The suggestion is not in that step") =>
  new HTTPException(409, { message });

async function withQuestions(db: Database, id: SuggestionId) {
  const [row] = await db
    .select(columns)
    .from(knowledgeSuggestions)
    .where(eq(knowledgeSuggestions.id, id));
  if (!row) throw new HTTPException(404, { message: "Suggestion not found" });
  const questions = await db
    .select({
      position: knowledgeQuestions.position,
      question: knowledgeQuestions.question,
      suggestedAnswers: knowledgeQuestions.suggestedAnswers,
      answer: knowledgeQuestions.answer,
      skipped: knowledgeQuestions.skipped,
    })
    .from(knowledgeQuestions)
    .where(eq(knowledgeQuestions.suggestionId, id))
    .orderBy(asc(knowledgeQuestions.position));
  return { ...row, questions };
}

const listKnowledgeSuggestions = defineQuillsRoute({
  method: "get",
  path: "/assistant/knowledge-suggestions",
  operationId: "listQuillsKnowledgeSuggestions",
  summary: "List the knowledge suggestions",
  description:
    "Open suggestions (waiting for answers, drafting, or with a draft ready) by default: gaps of the customer agent first, then by evidence, then newest. At most 200.",
  action: "manage_settings",
  query: z.object({
    status: z.enum(["open", "approved", "dismissed"]).default("open"),
  }),
  response: z.object({ items: z.array(suggestionSchema) }),
  responseDescription: "The suggestions",
  handler: async ({ db, query }) => ({
    items: await db
      .select(columns)
      .from(knowledgeSuggestions)
      .where(
        query.status === "open"
          ? inArray(knowledgeSuggestions.status, [...OPEN_STATUSES])
          : eq(knowledgeSuggestions.status, query.status),
      )
      .orderBy(
        desc(knowledgeSuggestions.gap),
        desc(knowledgeSuggestions.evidenceCount),
        desc(knowledgeSuggestions.updatedAt),
      )
      .limit(LIST_LIMIT),
  }),
});

const getKnowledgeSuggestion = defineQuillsRoute({
  method: "get",
  path: "/assistant/knowledge-suggestions/{suggestionId}",
  operationId: "getQuillsKnowledgeSuggestion",
  summary: "Get a knowledge suggestion with its questions",
  action: "manage_settings",
  params,
  response: detailSchema,
  responseDescription: "The suggestion and its questions in order",
  errors: { 404: errors[404] },
  // A plain read: no row lock for a page that refetches on every change.
  handler: ({ db, params }) => withQuestions(db, params.suggestionId),
});

const answerKnowledgeSuggestion = defineQuillsRoute({
  method: "post",
  path: "/assistant/knowledge-suggestions/{suggestionId}/answer",
  operationId: "answerQuillsKnowledgeSuggestion",
  summary: "Answer or skip the next question of a knowledge suggestion",
  description:
    "Answers or skips the question at `stepIndex`, which must be the suggestion's current step (409 otherwise, for example when another teammate answered it first). After the last question the suggestion moves to `drafting` and the AI writes the draft.",
  action: "manage_settings",
  params,
  body: z
    .object({
      stepIndex: z
        .number()
        .int()
        .min(0)
        .describe("The position of the question this answer is for."),
      answer: z.string().trim().min(1).max(1000).optional(),
      skip: z.literal(true).optional(),
    })
    .refine(
      (body) => (body.answer === undefined) !== (body.skip === undefined),
      {
        message: "Send an answer or skip, not both",
      },
    ),
  response: detailSchema,
  responseDescription: "The suggestion after the answer",
  errors,
  event: ({ params }, result) => ({
    type:
      result.status === "drafting"
        ? "knowledge_suggestion.answered"
        : "knowledge_suggestion.updated",
    entityType: "knowledge_suggestion",
    entityId: params.suggestionId,
  }),
  handler: async ({ db, actor, params, body }) => {
    const suggestion = await findSuggestion(db, params.suggestionId);
    if (
      suggestion.status !== "awaiting_answer" ||
      suggestion.stepIndex !== body.stepIndex
    )
      throw conflict();
    const next = afterTurn(suggestion);
    await db
      .update(knowledgeQuestions)
      .set({
        answer: body.answer ?? null,
        skipped: body.skip === true,
        answeredById: actor.principalId,
        answeredAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeQuestions.suggestionId, params.suggestionId),
          eq(knowledgeQuestions.position, suggestion.stepIndex),
        ),
      );
    await db
      .update(knowledgeSuggestions)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(knowledgeSuggestions.id, params.suggestionId));
    return withQuestions(db, params.suggestionId);
  },
});

const updateKnowledgeSuggestion = defineQuillsRoute({
  method: "patch",
  path: "/assistant/knowledge-suggestions/{suggestionId}",
  operationId: "updateQuillsKnowledgeSuggestion",
  summary: "Edit the draft of a knowledge suggestion",
  description: "Only a suggestion with a draft ready can be edited.",
  action: "manage_settings",
  params,
  body: z
    .object({
      title: fields.title.optional(),
      content: fields.content.optional(),
    })
    .refine(someField, { message: "Change at least one field" }),
  response: suggestionSchema,
  responseDescription: "The edited suggestion",
  errors,
  event: ({ params }) => ({
    type: "knowledge_suggestion.updated",
    entityType: "knowledge_suggestion",
    entityId: params.suggestionId,
  }),
  handler: async ({ db, params, body }) => {
    const suggestion = await findSuggestion(db, params.suggestionId);
    if (suggestion.status !== "draft_ready") throw conflict();
    const [row] = await db
      .update(knowledgeSuggestions)
      .set({ title: body.title, content: body.content, updatedAt: new Date() })
      .where(eq(knowledgeSuggestions.id, params.suggestionId))
      .returning(columns);
    return row!;
  },
});

const approveKnowledgeSuggestion = defineQuillsRoute({
  method: "post",
  path: "/assistant/knowledge-suggestions/{suggestionId}/approve",
  operationId: "approveQuillsKnowledgeSuggestion",
  summary: "Approve a knowledge suggestion into an assistant snippet",
  description: `Creates an assistant snippet from the draft (or the given title and content), with the chosen audience, and marks the suggestion approved. A workspace has at most ${MAX_SNIPPETS} snippets.`,
  action: "manage_settings",
  params,
  body: z.object({
    audience: z
      .enum(ASSISTANT_SNIPPET_AUDIENCES)
      .describe(
        "`team` keeps the snippet for teammates and the copilot; `public` lets the customer agent use it.",
      ),
    title: fields.title.optional(),
    content: fields.content.optional(),
    /** When true, also creates an unpublished Help Center draft article with provenance (#299). */
    createDraftArticle: z.boolean().optional(),
  }),
  response: suggestionSchema.extend({
    draftArticleId: z.string().nullable().optional(),
  }),
  responseDescription:
    "The approved suggestion, with the new snippet and optional draft article ID",
  errors: {
    ...errors,
    409: `The suggestion is not in that step, or the workspace has ${MAX_SNIPPETS} snippets`,
  },
  event: ({ params }, result) => [
    {
      type: "knowledge_suggestion.approved",
      entityType: "knowledge_suggestion",
      entityId: params.suggestionId,
    },
    {
      type: "assistant_snippet.created",
      entityType: "assistant_snippet",
      entityId: result.approvedSnippetId!,
    },
  ],
  handler: async ({ db, actor, params, body }) => {
    const suggestion = await findSuggestion(db, params.suggestionId);
    if (
      suggestion.status !== "draft_ready" ||
      !suggestion.title ||
      !suggestion.content
    )
      throw conflict();
    if ((await db.$count(assistantSnippets)) >= MAX_SNIPPETS)
      throw conflict(`A workspace has at most ${MAX_SNIPPETS} snippets`);
    const finalTitle = body.title ?? suggestion.title;
    const finalContent = body.content ?? suggestion.content;
    const [snippet] = await db
      .insert(assistantSnippets)
      .values({
        title: finalTitle,
        content: finalContent,
        audience: body.audience,
        enabled: true,
        createdById: actor.principalId,
      })
      .returning({ id: assistantSnippets.id });

    let draftArticleId: string | null = null;
    if (body.createDraftArticle) {
      const [category] = await db
        .select({ id: helpCenterCategories.id })
        .from(helpCenterCategories)
        .where(isNull(helpCenterCategories.deletedAt))
        .orderBy(asc(helpCenterCategories.position))
        .limit(1);
      if (category) {
        const [source] = await db
          .select({ conversationId: knowledgeSources.conversationId })
          .from(knowledgeSources)
          .where(eq(knowledgeSources.suggestionId, suggestion.id))
          .limit(1);
        const baseSlug =
          finalTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60) || "learned-article";
        const [article] = await db
          .insert(helpCenterArticles)
          .values({
            categoryId: category.id,
            slug: `${baseSlug}-${Date.now().toString(36)}`,
            title: finalTitle,
            content: finalContent,
            principalId: actor.principalId,
            publishedAt: null, // Never auto-published — teammate reviews in Help Center.
            sourceConversationId: source?.conversationId ?? null,
            sourceType: "learned",
          })
          .returning({ id: helpCenterArticles.id });
        draftArticleId = article?.id ?? null;
      }
    }

    const [row] = await db
      .update(knowledgeSuggestions)
      .set({
        status: "approved",
        title: finalTitle,
        content: finalContent,
        approvedSnippetId: snippet!.id,
        decidedById: actor.principalId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSuggestions.id, params.suggestionId))
      .returning(columns);
    return { ...row!, draftArticleId };
  },
});

const dismissKnowledgeSuggestion = defineQuillsRoute({
  method: "post",
  path: "/assistant/knowledge-suggestions/{suggestionId}/dismiss",
  operationId: "dismissQuillsKnowledgeSuggestion",
  summary: "Dismiss a knowledge suggestion",
  description: "The AI never suggests a dismissed topic again.",
  action: "manage_settings",
  params,
  response: suggestionSchema,
  responseDescription: "The dismissed suggestion",
  errors,
  event: ({ params }) => ({
    type: "knowledge_suggestion.dismissed",
    entityType: "knowledge_suggestion",
    entityId: params.suggestionId,
  }),
  handler: async ({ db, actor, params }) => {
    const suggestion = await findSuggestion(db, params.suggestionId);
    if (!(OPEN_STATUSES as readonly string[]).includes(suggestion.status))
      throw conflict();
    const [row] = await db
      .update(knowledgeSuggestions)
      .set({
        status: "dismissed",
        decidedById: actor.principalId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSuggestions.id, params.suggestionId))
      .returning(columns);
    return row!;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listKnowledgeSuggestions)
  .openapi(...getKnowledgeSuggestion)
  .openapi(...answerKnowledgeSuggestion)
  .openapi(...updateKnowledgeSuggestion)
  .openapi(...approveKnowledgeSuggestion)
  .openapi(...dismissKnowledgeSuggestion);
