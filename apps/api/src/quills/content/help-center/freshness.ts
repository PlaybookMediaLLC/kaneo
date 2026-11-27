import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import { principal } from "../../../database/quills/schema/auth";
import {
  helpCenterArticles,
  kbArticleLinks,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute, type Database } from "../../framework/define-route";

const articleParams = z.object({
  articleId: flexibleToTypeIdSchema("article"),
});

const STALE_REASONS = [
  "manual",
  "review_overdue",
  "unhelpful_spike",
  "changelog_published",
  "product_change",
] as const;

const linkInputSchema = z.object({
  targetKind: z.enum(["changelog", "post", "url"]),
  targetId: z.string().trim().min(1).max(500),
});

const linkViewSchema = linkInputSchema.extend({
  id: z.string(),
  createdAt: responseTimestamp,
});

const freshnessArticleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  reviewBy: nullableResponseTimestamp,
  lastReviewedAt: nullableResponseTimestamp,
  staleReason: z.string().nullable(),
  staleDetails: z.string().nullable(),
  staleFlaggedAt: nullableResponseTimestamp,
  helpfulCount: z.number(),
  notHelpfulCount: z.number(),
  links: z.array(linkViewSchema),
});

async function loadArticleFreshness(db: Database, articleIds: string[]) {
  if (!articleIds.length) return [];
  const rows = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      ownerId: helpCenterArticles.ownerId,
      ownerName: principal.displayName,
      reviewBy: helpCenterArticles.reviewBy,
      lastReviewedAt: helpCenterArticles.lastReviewedAt,
      staleReason: helpCenterArticles.staleReason,
      staleDetails: helpCenterArticles.staleDetails,
      staleFlaggedAt: helpCenterArticles.staleFlaggedAt,
      helpfulCount: helpCenterArticles.helpfulCount,
      notHelpfulCount: helpCenterArticles.notHelpfulCount,
    })
    .from(helpCenterArticles)
    .leftJoin(principal, eq(principal.id, helpCenterArticles.ownerId))
    .where(
      and(
        inArray(helpCenterArticles.id, articleIds as never[]),
        isNull(helpCenterArticles.deletedAt),
      ),
    );
  const links = await db
    .select({
      id: kbArticleLinks.id,
      articleId: kbArticleLinks.articleId,
      targetKind: kbArticleLinks.targetKind,
      targetId: kbArticleLinks.targetId,
      createdAt: kbArticleLinks.createdAt,
    })
    .from(kbArticleLinks)
    .where(inArray(kbArticleLinks.articleId, articleIds as never[]));
  const byArticle = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = byArticle.get(link.articleId) ?? [];
    bucket.push(link);
    byArticle.set(link.articleId, bucket);
  }
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        links: (byArticle.get(row.id) ?? []).map((link) => ({
          id: link.id,
          targetKind: link.targetKind,
          targetId: link.targetId,
          createdAt: link.createdAt,
        })),
      },
    ]),
  );
  return articleIds
    .map((id) => byId.get(id as never))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

/**
 * Flags KB articles as stale when a linked changelog entry or post is published (#314).
 * Never overwrites an existing stale flag.
 */
export async function flagLinkedArticlesOnChangelogPublish(
  db: Database,
  changelogId: string,
  changelogTitle: string,
  linkedPostIds: readonly string[],
) {
  const conditions = [
    and(
      eq(kbArticleLinks.targetKind, "changelog"),
      eq(kbArticleLinks.targetId, changelogId),
    ),
  ];
  if (linkedPostIds.length) {
    conditions.push(
      and(
        eq(kbArticleLinks.targetKind, "post"),
        inArray(kbArticleLinks.targetId, [...linkedPostIds]),
      ),
    );
  }
  const linked = await db
    .select({ articleId: kbArticleLinks.articleId })
    .from(kbArticleLinks)
    .where(or(...conditions));
  const ids = [...new Set(linked.map((row) => row.articleId))];
  if (!ids.length) return 0;
  const updated = await db
    .update(helpCenterArticles)
    .set({
      staleReason: "changelog_published",
      staleDetails: `Linked changelog published: ${changelogTitle.slice(0, 180)}`,
      staleFlaggedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(helpCenterArticles.id, ids),
        isNull(helpCenterArticles.deletedAt),
        isNull(helpCenterArticles.staleFlaggedAt),
      ),
    )
    .returning({ id: helpCenterArticles.id });
  return updated.length;
}

const reviewQueue = defineQuillsRoute({
  method: "get",
  path: "/help-center/review-queue",
  operationId: "listQuillsHelpCenterReviewQueue",
  summary: "List stale and overdue help-center articles needing review",
  description:
    "Returns live articles flagged as stale or whose review_by date has passed, ordered by staleness and review deadline.",
  action: "read",
  query: z.object({
    ownerId: flexibleToTypeIdSchema("principal").optional(),
    includeAll: z
      .preprocess(
        (v) =>
          v === "true" || v === "1" || v === true
            ? true
            : v === "false" || v === "0" || v === false
              ? false
              : v,
        z.boolean(),
      )
      .default(false),
    limit: pagingNumber(1, 100, 50),
  }),
  response: z.object({
    items: z.array(freshnessArticleSchema),
  }),
  responseDescription: "Articles in the freshness review queue",
  handler: async ({ db, query }) => {
    const rows = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          isNull(helpCenterArticles.deletedAt),
          query.ownerId
            ? eq(helpCenterArticles.ownerId, query.ownerId)
            : undefined,
          query.includeAll
            ? undefined
            : or(
                isNotNull(helpCenterArticles.staleFlaggedAt),
                and(
                  isNotNull(helpCenterArticles.reviewBy),
                  lte(helpCenterArticles.reviewBy, sql`now()`),
                ),
              ),
        ),
      )
      .orderBy(
        asc(helpCenterArticles.staleFlaggedAt),
        asc(helpCenterArticles.reviewBy),
        asc(helpCenterArticles.id),
      )
      .limit(query.limit);
    return {
      items: await loadArticleFreshness(
        db,
        rows.map((r) => r.id),
      ),
    };
  },
});

const updateFreshness = defineQuillsRoute({
  method: "patch",
  path: "/help-center/articles/{articleId}/freshness",
  operationId: "updateQuillsHelpCenterArticleFreshness",
  summary: "Set a help-center article's owner, review date and linked entities",
  action: "update",
  params: articleParams,
  body: z
    .object({
      ownerId: flexibleToTypeIdSchema("principal").nullable().optional(),
      reviewBy: z.iso.datetime({ offset: true }).max(64).nullable().optional(),
      links: z.array(linkInputSchema).max(20).optional(),
    })
    .refine(
      (b) =>
        b.ownerId !== undefined ||
        b.reviewBy !== undefined ||
        b.links !== undefined,
      "Provide at least one field to update",
    ),
  response: freshnessArticleSchema,
  responseDescription: "Updated article freshness metadata",
  errors: { 404: "Article or owner not found" },
  event: ({ params }) => ({
    type: "help_center.article_freshness_updated",
    entityType: "article",
    entityId: params.articleId,
  }),
  handler: async ({ db, params, body }) => {
    const [article] = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          eq(helpCenterArticles.id, params.articleId),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .for("update");
    if (!article)
      throw new HTTPException(404, { message: "Article not found" });

    if (body.ownerId) {
      const [owner] = await db
        .select({ id: principal.id })
        .from(principal)
        .where(
          and(eq(principal.id, body.ownerId), isNotNull(principal.kaneoUserId)),
        )
        .limit(1);
      if (!owner) throw new HTTPException(404, { message: "Owner not found" });
    }

    if (body.links !== undefined) {
      for (const link of body.links) {
        if (link.targetKind === "url") {
          try {
            const parsed = new URL(link.targetId);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              throw new HTTPException(400, {
                message: "Link URL must use http or https",
              });
            }
          } catch (err) {
            if (err instanceof HTTPException) throw err;
            throw new HTTPException(400, { message: "Invalid link URL" });
          }
        }
      }
    }

    await db
      .update(helpCenterArticles)
      .set({
        ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
        ...(body.reviewBy !== undefined && {
          reviewBy: body.reviewBy ? new Date(body.reviewBy) : null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(helpCenterArticles.id, article.id));

    if (body.links !== undefined) {
      await db
        .delete(kbArticleLinks)
        .where(eq(kbArticleLinks.articleId, article.id));
      const deduped = [
        ...new Map(
          body.links.map((l) => [`${l.targetKind}:${l.targetId}`, l]),
        ).values(),
      ];
      if (deduped.length) {
        await db.insert(kbArticleLinks).values(
          deduped.map((link) => ({
            articleId: article.id,
            targetKind: link.targetKind,
            targetId: link.targetId,
          })),
        );
      }
    }

    const [loaded] = await loadArticleFreshness(db, [article.id]);
    return loaded!;
  },
});

const markReviewed = defineQuillsRoute({
  method: "post",
  path: "/help-center/articles/{articleId}/mark-reviewed",
  operationId: "markQuillsHelpCenterArticleReviewed",
  summary: "Mark a help-center article as reviewed and clear staleness flags",
  action: "update",
  params: articleParams,
  body: z.object({
    nextReviewDays: z.number().int().min(1).max(730),
  }),
  response: freshnessArticleSchema,
  responseDescription: "The freshly reviewed article",
  errors: { 404: "Article not found" },
  event: ({ params }) => ({
    type: "help_center.article_reviewed",
    entityType: "article",
    entityId: params.articleId,
  }),
  handler: async ({ db, params, body }) => {
    const now = new Date();
    const nextReviewBy = new Date(
      now.getTime() + body.nextReviewDays * 86_400_000,
    );
    const [updated] = await db
      .update(helpCenterArticles)
      .set({
        lastReviewedAt: now,
        reviewBy: nextReviewBy,
        staleReason: null,
        staleDetails: null,
        staleFlaggedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(helpCenterArticles.id, params.articleId),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .returning({ id: helpCenterArticles.id });
    if (!updated)
      throw new HTTPException(404, { message: "Article not found" });
    const [loaded] = await loadArticleFreshness(db, [updated.id]);
    return loaded!;
  },
});

const flagStale = defineQuillsRoute({
  method: "post",
  path: "/help-center/articles/{articleId}/flag-stale",
  operationId: "flagQuillsHelpCenterArticleStale",
  summary:
    "Flag a help-center article as stale and exclude it from AI grounding",
  action: "update",
  params: articleParams,
  body: z.object({
    reason: z.enum(STALE_REASONS),
    details: z.string().trim().max(500).optional(),
  }),
  response: freshnessArticleSchema,
  responseDescription: "The flagged article",
  errors: { 404: "Article not found" },
  event: ({ params, body }) => ({
    type: "help_center.article_stale_flagged",
    entityType: "article",
    entityId: params.articleId,
    payload: { reason: body.reason },
  }),
  handler: async ({ db, params, body }) => {
    const now = new Date();
    const [updated] = await db
      .update(helpCenterArticles)
      .set({
        staleReason: body.reason,
        staleDetails: body.details ?? null,
        staleFlaggedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(helpCenterArticles.id, params.articleId),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .returning({ id: helpCenterArticles.id });
    if (!updated)
      throw new HTTPException(404, { message: "Article not found" });
    const [loaded] = await loadArticleFreshness(db, [updated.id]);
    return loaded!;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reviewQueue)
  .openapi(...updateFreshness)
  .openapi(...markReviewed)
  .openapi(...flagStale);
