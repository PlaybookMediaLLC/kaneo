import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  chooseTags,
  DUPLICATE_CONFIDENCE,
  findExamples,
  judgeDuplicate,
  renderExamples,
  selectExamples,
  TASKS,
  type Example,
} from "@quills/ai/learning";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import {
  assistantDocuments,
  assistantSnippets,
} from "../../../database/quills/schema/assistant";
import { boards, postTags } from "../../../database/quills/schema/boards";
import { conversations } from "../../../database/quills/schema/conversation";
import { conversationSummaries } from "../../../database/quills/schema/conversation-summary";
import {
  helpCenterArticles,
  helpCenterArticleTranslations,
} from "../../../database/quills/schema/kb";
import { mergeSuggestions } from "../../../database/quills/schema/merge-suggestions";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import {
  postTagAssignments,
  posts,
} from "../../../database/quills/schema/posts";
import { postSentiment } from "../../../database/quills/schema/sentiment";
import { ticketSummaries } from "../../../database/quills/schema/ticket-summary";
import { tickets } from "../../../database/quills/schema/tickets";
import { recordQuillsChange } from "../../events";
import { readConfig as readHelpCenterConfig } from "../../content/help-center/shared";
import { aiConfig, chatJson, embed, untrusted, type Usage } from "../provider";
import { exactDistance, storedPostVector, vectorParam } from "./distance";
import { createLearningStore } from "./learning-store";
import { runCapability } from "../ai/run";
import { logUsage, type UsageEntry } from "../runs";
import {
  failedUsage,
  nothing,
  requesterActions,
  transcript,
  type Work,
  type Write,
} from "./shared";

// Background AI work: embeddings, sentiment, summaries, tags, duplicate checks and translations.
// Each reads, calls the provider with no transaction open, then returns its write. A provider
// failure throws, so the worker retries the job; the usage log keeps successful calls only.

const embeddingsOn = () => Boolean(aiConfig()?.embeddingModel);
const BATCH = 32;
/**
 * A job starts no provider call after this long. With the 60-second call timeout, it ends inside
 * its five-minute lease. ponytail: work past the budget is skipped, not queued; the teammate
 * requests it again. Split it into one job per item if that is common.
 */
const BUDGET_MS = 180_000;
const budget = () => {
  const end = Date.now() + BUDGET_MS;
  return () => Date.now() < end;
};
type Left = ReturnType<typeof budget>;
const usageEntry = (
  step: string,
  callType: UsageEntry["callType"],
  usage: Usage,
  postId?: string,
): UsageEntry => ({ step, callType, usage, postId });

/** Embeds rows of one kind and returns the updates, in batches of 32. */
async function embedRows<T extends { id: string; text: string }>(
  rows: T[],
  step: string,
  usage: UsageEntry[],
  left: Left = budget(),
) {
  const out: { id: string; values: number[] }[] = [];
  for (let i = 0; i < rows.length && left(); i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const result = await embed(batch.map((row) => row.text));
    usage.push(usageEntry(step, "embedding", result.usage));
    batch.forEach((row, index) =>
      out.push({ id: row.id, values: result.vectors[index]! }),
    );
  }
  return out;
}

const postText = (post: { title: string; content: string }) =>
  `${post.title}\n${post.content}`.slice(0, 8000);
export const embeddingSet = (values: number[]) => ({
  embedding: vectorParam(values) as never,
  embeddingModel: aiConfig()!.embeddingModel,
  embeddingUpdatedAt: new Date(),
});

/**
 * assistant.embeddings_requested: embeds up to 32 posts, articles, snippets and documents each
 * without an embedding. Snippets and documents created later are embedded by embed-knowledge.ts.
 */
export const backfillEmbeddings: Work = async (workspaceId) => {
  if (!embeddingsOn()) return nothing;
  // ponytail: one call per kind per request; send more requests for more rows.
  const pending = await withQuillsSystemWorkspace(workspaceId, async (db) => ({
    posts: await db
      .select({ id: posts.id, title: posts.title, content: posts.content })
      .from(posts)
      .where(and(isNull(posts.embedding), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt))
      .limit(BATCH),
    articles: await db
      .select({
        id: helpCenterArticles.id,
        title: helpCenterArticles.title,
        content: helpCenterArticles.content,
      })
      .from(helpCenterArticles)
      .where(
        and(
          isNull(helpCenterArticles.embedding),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .limit(BATCH),
    snippets: await db
      .select({
        id: assistantSnippets.id,
        title: assistantSnippets.title,
        content: assistantSnippets.content,
      })
      .from(assistantSnippets)
      .where(isNull(assistantSnippets.embedding))
      .limit(BATCH),
    documents: await db
      .select({
        id: assistantDocuments.id,
        title: assistantDocuments.title,
        content: assistantDocuments.content,
      })
      .from(assistantDocuments)
      .where(
        and(
          isNull(assistantDocuments.embedding),
          isNull(assistantDocuments.deletedAt),
        ),
      )
      .limit(BATCH),
  }));
  const usage: UsageEntry[] = [];
  const left = budget();
  const text = (rows: { id: string; title: string; content: string }[]) =>
    rows.map((row) => ({ id: row.id, text: postText(row) }));
  const [donePosts, doneArticles, doneSnippets, doneDocuments] =
    await Promise.all([
      embedRows(text(pending.posts), "post_embedding", usage, left),
      embedRows(text(pending.articles), "article_embedding", usage, left),
      embedRows(text(pending.snippets), "snippet_embedding", usage, left),
      embedRows(text(pending.documents), "document_embedding", usage, left),
    ]);
  const model = aiConfig()!.embeddingModel;
  const bulkUpdateEmbeddings = async (
    db: Database,
    table:
      | typeof posts
      | typeof helpCenterArticles
      | typeof assistantSnippets
      | typeof assistantDocuments,
    rows: { id: string; values: number[] }[],
  ) => {
    if (!rows.length) return;
    const now = new Date();
    const tuples = sql.join(
      rows.map(
        (row) =>
          sql`(${sql.param(row.id, table.id)}::uuid, ${vectorParam(row.values)})`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE ${table} AS t
      SET embedding = v.embedding,
          embedding_model = ${model},
          embedding_updated_at = ${now}
      FROM (VALUES ${tuples}) AS v(id, embedding)
      WHERE t.id = v.id AND t.embedding IS NULL
    `);
  };
  return async (db) => {
    await logUsage(db, usage);
    await bulkUpdateEmbeddings(db, posts, donePosts);
    await bulkUpdateEmbeddings(db, helpCenterArticles, doneArticles);
    await bulkUpdateEmbeddings(db, assistantSnippets, doneSnippets);
    await bulkUpdateEmbeddings(db, assistantDocuments, doneDocuments);
  };
};

const SIMILARITY = 0.85;

/**
 * post.created and post.merge_check_requested: embeds the post when needed, then asks the model
 * about the three most similar posts and stores a pending suggestion for each likely duplicate.
 * A pair that already has a suggestion, in any status or direction, is not suggested again.
 */
export const checkDuplicates: Work = async (workspaceId, event) => {
  if (!embeddingsOn()) return nothing;
  const [post] = await withQuillsSystemWorkspace(workspaceId, (db) =>
    db
      .select({
        id: posts.id,
        boardId: posts.boardId,
        title: posts.title,
        content: posts.content,
        voteCount: posts.voteCount,
        embedded: sql<boolean>`${posts.embedding} IS NOT NULL`,
        embeddingModel: posts.embeddingModel,
      })
      .from(posts)
      .where(
        and(
          eq(posts.id, event.entityId as never),
          isNull(posts.deletedAt),
          isNull(posts.canonicalPostId),
        ),
      ),
  );
  if (!post) return nothing;
  const usage: UsageEntry[] = [];
  const left = budget();
  const embedded = post.embedded
    ? null
    : (
        await embedRows(
          [{ id: post.id, text: postText(post) }],
          "post_embedding",
          usage,
          left,
        )
      )[0]!;
  const target = embedded
    ? vectorParam(embedded.values)
    : storedPostVector(post.id);
  const distance = exactDistance(posts.embedding, target);
  const embeddingModel = embedded
    ? aiConfig()!.embeddingModel
    : post.embeddingModel;
  const { candidates, examples, exampleCandidates } =
    await withQuillsSystemWorkspace(workspaceId, async (db) => {
      const candidates = await db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          voteCount: posts.voteCount,
          similarity: sql<number>`(1 - ${distance})::float8`,
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .where(
          and(
            ne(posts.id, post.id),
            isNotNull(posts.embedding),
            isNull(posts.deletedAt),
            isNull(posts.canonicalPostId),
            isNull(boards.deletedAt),
            sql`(1 - ${distance}) >= ${SIMILARITY}`,
          ),
        )
        .orderBy(distance)
        .limit(3);
      // Earlier teammate decisions near this post, from the boards that anyone who sees a
      // suggestion for it can read (learning-store.ts).
      const rows =
        candidates.length && embeddingModel
          ? await findExamples(createLearningStore(db, workspaceId), {
              task: "duplicate",
              scopeId: workspaceId,
              subjects: [{ key: post.id, embedding: embedded?.values ?? null }],
              embeddingModel,
              visibility: {
                boardIds: [post.boardId],
                includeUnlinkedBoards: true,
              },
              excludeKeys: candidates.map((candidate) => candidate.id),
            })
          : [];
      return {
        candidates,
        examples: selectExamples(rows, TASKS.duplicate),
        exampleCandidates: rows.length,
      };
    });
  const examplesBlock = renderExamples("duplicate", examples, untrusted);
  const judged = left()
    ? await Promise.all(
        candidates.map(async (other) => {
          const answer = await runCapability(judgeDuplicate, {
            first: postText(post),
            second: postText(other),
            examples: examplesBlock,
          });
          usage.push({
            ...usageEntry(
              judgeDuplicate.step,
              "chat_completion",
              answer.usage,
              post.id,
            ),
            metadata: { examples: examples.length, exampleCandidates },
          });
          return answer.value.duplicate &&
            answer.value.confidence >= DUPLICATE_CONFIDENCE
            ? { other, verdict: answer.value, model: answer.usage.model }
            : null;
        }),
      )
    : [];
  const found = judged.filter((item): item is NonNullable<typeof item> =>
    Boolean(item),
  );
  return async (db) => {
    await logUsage(db, usage);
    await db
      .update(posts)
      .set({
        mergeCheckedAt: new Date(),
        ...(embedded && embeddingSet(embedded.values)),
      })
      .where(eq(posts.id, post.id));
    for (const { other, verdict: answer, model: llmModel } of found) {
      const pair = (a: string, b: string) =>
        and(
          eq(mergeSuggestions.sourcePostId, a as never),
          eq(mergeSuggestions.targetPostId, b as never),
        );
      if (
        await db.$count(
          mergeSuggestions,
          or(pair(post.id, other.id), pair(other.id, post.id)),
        )
      )
        continue;
      // The post with fewer votes merges into the one with more.
      const [source, targetPost] =
        post.voteCount <= other.voteCount
          ? [post.id, other.id]
          : [other.id, post.id];
      await db
        .insert(mergeSuggestions)
        .values({
          sourcePostId: source,
          targetPostId: targetPost,
          vectorScore: other.similarity,
          ftsScore: 0,
          hybridScore: other.similarity,
          llmConfidence: answer.confidence,
          llmReasoning: answer.reasoning,
          llmModel,
        })
        .onConflictDoNothing();
    }
  };
};

/** post.sentiment_requested: classifies the post and stores the result. */
export const classifySentiment: Work = async (workspaceId, event) => {
  const [post] = await withQuillsSystemWorkspace(workspaceId, (db) =>
    db
      .select({ id: posts.id, title: posts.title, content: posts.content })
      .from(posts)
      .where(
        and(eq(posts.id, event.entityId as never), isNull(posts.deletedAt)),
      ),
  );
  if (!post) return nothing;
  const answer = await chatJson(
    z.object({
      sentiment: z.enum(["positive", "neutral", "negative"]),
      confidence: z.number().min(0).max(1),
    }),
    [
      {
        role: "system",
        content:
          'Classify the sentiment of this feedback post. Answer with one JSON object: {"sentiment": "positive" | "neutral" | "negative", "confidence": number between 0 and 1}.',
      },
      { role: "user", content: untrusted("post", postText(post)) },
    ],
  );
  const values = {
    sentiment: answer.value.sentiment,
    confidence: answer.value.confidence,
    model: answer.usage.model,
    processedAt: new Date(),
    inputTokens: answer.usage.inputTokens,
    outputTokens: answer.usage.outputTokens,
  };
  return async (db) => {
    await logUsage(db, [
      usageEntry("sentiment", "chat_completion", answer.usage, post.id),
    ]);
    await db
      .insert(postSentiment)
      .values({ postId: post.id, ...values })
      .onConflictDoUpdate({
        target: [postSentiment.workspaceId, postSentiment.postId],
        set: values,
      });
  };
};

const summarySchema = z.object({ text: z.string().min(1).max(2000) });
const summarize = (kind: "conversation" | "ticket", thread: string) =>
  chatJson(summarySchema, [
    {
      role: "system",
      content: `Summarize this support ${kind} for a teammate in at most five short sentences: the problem, what was tried and what is open. Answer with one JSON object: {"text": string}.`,
    },
    { role: "user", content: untrusted("thread", thread) },
  ]);

/** conversation.summary_requested: writes the conversation's summary. */
export const summarizeConversation: Work = async (workspaceId, event) => {
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [conversation] = await db
      .select({
        id: conversations.id,
        visitor: conversations.visitorPrincipalId,
      })
      .from(conversations)
      .where(eq(conversations.id, event.entityId as never));
    return (
      conversation && {
        conversation,
        thread: await transcript(
          db,
          { conversationId: conversation.id },
          true,
          60,
        ),
      }
    );
  });
  if (!context?.thread) return nothing;
  const answer = await summarize("conversation", context.thread);
  const { conversation } = context;
  return async (db) => {
    await logUsage(db, [
      usageEntry("conversation_summary", "chat_completion", answer.usage),
    ]);
    await db
      .insert(conversationSummaries)
      .values({
        conversationId: conversation.id,
        visitorPrincipalId: conversation.visitor,
        summary: answer.value.text,
      })
      .onConflictDoUpdate({
        target: [
          conversationSummaries.workspaceId,
          conversationSummaries.conversationId,
        ],
        set: { summary: answer.value.text, updatedAt: new Date() },
      });
    await recordQuillsChange(db, null, {
      type: "conversation.summarized",
      entityType: "conversation",
      entityId: conversation.id,
    });
  };
};

/** ticket.summary_requested: writes the ticket's summary. */
export const summarizeTicket: Work = async (workspaceId, event) => {
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [ticket] = await db
      .select({
        id: tickets.id,
        title: tickets.title,
        requester: tickets.requesterPrincipalId,
      })
      .from(tickets)
      .where(
        and(eq(tickets.id, event.entityId as never), isNull(tickets.deletedAt)),
      );
    return (
      ticket && {
        ticket,
        thread: await transcript(db, { ticketId: ticket.id }, true, 60),
      }
    );
  });
  if (!context) return nothing;
  const { ticket } = context;
  const answer = await summarize(
    "ticket",
    `Title: ${ticket.title}\n${context.thread}`,
  );
  return async (db) => {
    await logUsage(db, [
      usageEntry("ticket_summary", "chat_completion", answer.usage),
    ]);
    await db
      .insert(ticketSummaries)
      .values({
        ticketId: ticket.id,
        requesterPrincipalId: ticket.requester,
        summary: answer.value.text,
      })
      .onConflictDoUpdate({
        target: [ticketSummaries.workspaceId, ticketSummaries.ticketId],
        set: { summary: answer.value.text, updatedAt: new Date() },
      });
    await recordQuillsChange(db, null, {
      type: "ticket.summarized",
      entityType: "ticket",
      entityId: ticket.id,
    });
  };
};

/**
 * post.tags_backfill_requested: picks existing tags for untagged posts, as the requester, who
 * must still hold quills:update. With no board, only boards without project links are in scope:
 * they are the boards every teammate can see.
 */
export const backfillTags: Work = async (workspaceId, event) => {
  if (
    !event.actorId ||
    !(await requesterActions(workspaceId, event.actorId)).includes("update")
  )
    return nothing;
  const payload = event.payload as { boardId?: string; limit?: string };
  const limit = Math.min(30, Math.max(1, Number(payload.limit) || 25));
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const tags = await db
      .select({ id: postTags.id, name: postTags.name })
      .from(postTags)
      .where(isNull(postTags.deletedAt))
      .orderBy(asc(postTags.name))
      .limit(100);
    const batchPosts = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        embedded: sql<boolean>`${posts.embedding} IS NOT NULL`,
        embeddingModel: posts.embeddingModel,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(
          isNull(posts.deletedAt),
          isNull(boards.deletedAt),
          payload.boardId
            ? eq(posts.boardId, payload.boardId as never)
            : notExists(
                db
                  .select({ id: boardProjects.boardId })
                  .from(boardProjects)
                  .where(eq(boardProjects.boardId, boards.id)),
              ),
          notExists(
            db
              .select({ id: postTagAssignments.postId })
              .from(postTagAssignments)
              .where(eq(postTagAssignments.postId, posts.id)),
          ),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(limit);
    // Posts that a teammate tagged by hand near the posts of each batch of 10, from the boards
    // this job reads plus the boards every teammate can see (learning-store.ts). One query per
    // batch; only vectors of the configured model compare, so older vectors get no examples.
    const examples = new Map<number, Example[]>();
    const model = aiConfig()?.embeddingModel;
    if (tags.length && model) {
      const store = createLearningStore(db, workspaceId);
      const ids = batchPosts.map((post) => post.id);
      for (let i = 0; i < batchPosts.length; i += 10) {
        const subjects = batchPosts
          .slice(i, i + 10)
          .filter((post) => post.embedded && post.embeddingModel === model)
          .map((post) => ({ key: post.id, embedding: null }));
        if (subjects.length)
          examples.set(
            i,
            await findExamples(store, {
              task: "tags",
              scopeId: workspaceId,
              subjects,
              embeddingModel: model,
              visibility: {
                boardIds: payload.boardId ? [payload.boardId] : [],
                includeUnlinkedBoards: true,
              },
              excludeKeys: ids,
            }),
          );
      }
    }
    return { tags, posts: batchPosts, examples };
  });
  if (!context.tags.length || !context.posts.length) return nothing;
  const tagIds = new Set<string>(context.tags.map((tag) => tag.id));
  const usage: UsageEntry[] = [];
  const picks: { postId: string; tagIds: string[] }[] = [];
  // ponytail: 10 posts per model call; a larger batch risks a truncated answer.
  const left = budget();
  for (let i = 0; i < context.posts.length && left(); i += 10) {
    const batch = context.posts.slice(i, i + 10);
    const candidates = context.examples.get(i) ?? [];
    const picked = selectExamples(candidates, TASKS.tags);
    const answer = await runCapability(chooseTags, {
      tags: context.tags,
      posts: batch
        .map((post) => `${post.id}: ${postText(post).slice(0, 1000)}`)
        .join("\n\n"),
      examples: renderExamples("tags", picked, untrusted),
    });
    usage.push({
      ...usageEntry(chooseTags.step, "chat_completion", answer.usage),
      metadata: {
        examples: picked.length,
        exampleCandidates: candidates.length,
      },
    });
    const ids = new Set<string>(batch.map((post) => post.id));
    for (const entry of answer.value.posts)
      if (ids.has(entry.postId)) {
        const chosen = [...new Set(entry.tagIds)].filter((id) =>
          tagIds.has(id),
        );
        if (chosen.length) picks.push({ postId: entry.postId, tagIds: chosen });
      }
  }
  return async (db) => {
    await logUsage(db, usage);
    for (const pick of picks) {
      const added = await db
        .insert(postTagAssignments)
        .values(
          pick.tagIds.map((tagId) => ({
            postId: pick.postId as never,
            tagId: tagId as never,
            autoTagged: true,
          })),
        )
        .onConflictDoNothing()
        .returning({ postId: postTagAssignments.postId });
      if (added.length)
        await recordQuillsChange(
          db,
          { principalId: event.actorId as never },
          {
            type: "post.tags_changed",
            entityType: "post",
            entityId: pick.postId,
            payload: { source: "ai" },
          },
        );
    }
  };
};

type Translation = {
  locale: string;
  title: string;
  description: string | null;
  content: string;
};

/**
 * Translates one article into each locale, one call each. A failed locale is logged and skipped;
 * the others are kept. When every call fails, the error is thrown so the job retries.
 */
async function translateArticle(
  workspaceId: string,
  articleId: string,
  locales: string[],
  usage: UsageEntry[],
  left: Left,
): Promise<Translation[]> {
  if (!locales.length) return [];
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => ({
    article: (
      await db
        .select({
          title: helpCenterArticles.title,
          description: helpCenterArticles.description,
          content: helpCenterArticles.content,
        })
        .from(helpCenterArticles)
        .where(
          and(
            eq(helpCenterArticles.id, articleId as never),
            isNull(helpCenterArticles.deletedAt),
          ),
        )
    )[0],
    terms: (await readHelpCenterConfig(db as never)).autoTranslate
      .protectedTerms,
  }));
  const { article, terms } = context;
  if (!article) return [];
  const results: Translation[] = [];
  let failure: unknown;
  const pendingLocales = locales.slice(0, 12);
  const CONCURRENCY = 3;
  for (let i = 0; i < pendingLocales.length && left(); i += CONCURRENCY) {
    const batch = pendingLocales.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (locale) => {
        if (!left()) return;
        try {
          const answer = await chatJson(
            z.object({
              title: z.string().min(1).max(500),
              description: z.string().max(1000).nullable(),
              content: z.string().min(1).max(200000),
            }),
            [
              {
                role: "system",
                content: [
                  `Translate this help-center article into the locale "${locale}". Keep Markdown, links, code and product names.`,
                  terms.length
                    ? `Never translate these terms: ${terms.slice(0, 100).join(", ")}.`
                    : "",
                  'Answer with one JSON object: {"title": string, "description": string | null, "content": string}.',
                ].join("\n"),
              },
              {
                role: "user",
                content: untrusted(
                  "article",
                  JSON.stringify({
                    title: article.title,
                    description: article.description,
                    // ponytail: a longer article is cut; translate it in parts when that matters.
                    content: article.content.slice(0, 30000),
                  }),
                ),
              },
            ],
            8000,
          );
          usage.push(
            usageEntry("article_translation", "chat_completion", answer.usage),
          );
          results.push({ locale, ...answer.value });
        } catch (error) {
          usage.push(
            failedUsage("article_translation", "chat_completion", error),
          );
          failure = error;
        }
      }),
    );
  }
  if (!results.length && failure) throw failure;
  return results;
}

/** Stores AI translations as drafts. A translation a teammate published is never replaced. */
const storeTranslations =
  (articleId: string, results: Translation[]): Write =>
  async (db: Database) => {
    for (const result of results)
      await db
        .insert(helpCenterArticleTranslations)
        .values({
          articleId: articleId as never,
          locale: result.locale,
          title: result.title,
          description: result.description,
          content: result.content,
        })
        .onConflictDoUpdate({
          target: [
            helpCenterArticleTranslations.workspaceId,
            helpCenterArticleTranslations.articleId,
            helpCenterArticleTranslations.locale,
          ],
          set: {
            title: result.title,
            description: result.description,
            content: result.content,
            contentJson: null,
            updatedAt: new Date(),
          },
          setWhere: sql`${helpCenterArticleTranslations.status} = 'draft'`,
        });
  };

/** help_center.article_translation_requested: one locale. */
export const translateRequested: Work = async (workspaceId, event) => {
  const locale = (event.payload as { locale?: string }).locale;
  const usage: UsageEntry[] = [];
  const results = await translateArticle(
    workspaceId,
    event.entityId,
    locale ? [locale] : [],
    usage,
    budget(),
  );
  return async (db) => {
    await logUsage(db, usage);
    await storeTranslations(event.entityId, results)(db);
  };
};

/** help_center.article_published: embeds the article, and translates it when the publish asked for it. */
export const articlePublished: Work = async (workspaceId, event) => {
  if (!aiConfig()) return nothing;
  const auto =
    (event.payload as { autoTranslate?: string }).autoTranslate === "requested";
  const { locales, article } = await withQuillsSystemWorkspace(
    workspaceId,
    async (db) => {
      const config = auto ? await readHelpCenterConfig(db as never) : null;
      const [row] = embeddingsOn()
        ? await db
            .select({
              id: helpCenterArticles.id,
              title: helpCenterArticles.title,
              content: helpCenterArticles.content,
            })
            .from(helpCenterArticles)
            .where(
              and(
                eq(helpCenterArticles.id, event.entityId as never),
                isNull(helpCenterArticles.deletedAt),
              ),
            )
        : [];
      return {
        locales:
          config?.locales.additional.filter(
            (code) => code !== config.locales.default,
          ) ?? [],
        article: row,
      };
    },
  );
  // One budget for the whole job, so translations and the embedding end inside the lease.
  const left = budget();
  const usage: UsageEntry[] = [];
  const embedded = article
    ? (
        await embedRows(
          [{ id: article.id, text: postText(article) }],
          "article_embedding",
          usage,
          left,
        )
      )[0]
    : undefined;
  const results = await translateArticle(
    workspaceId,
    event.entityId,
    locales,
    usage,
    left,
  );
  return async (db) => {
    await logUsage(db, usage);
    await storeTranslations(event.entityId, results)(db);
    if (embedded)
      await db
        .update(helpCenterArticles)
        .set(embeddingSet(embedded.values))
        .where(eq(helpCenterArticles.id, embedded.id as never));
  };
};
