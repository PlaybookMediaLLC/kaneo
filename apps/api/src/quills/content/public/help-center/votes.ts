// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, sql, type AnyColumn } from "drizzle-orm";
import type { KbArticleId } from "@kaneo/ids";
import { HTTPException } from "hono/http-exception";
import { z } from "../../../../openapi";
import {
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
} from "../../../../database/quills/schema/kb";
import type { QuillsCaller } from "../../../framework/audience";
import { notFound, visibleArticle, type Db, type Viewer } from "./visibility";

// A visitor's helpful or not-helpful vote on a public article, for the portal and the widget.
// A caller with a principal has one vote that a later vote changes. An anonymous vote has no
// owner, so each one is a new row, as in the source; the route's rate limit bounds them.

export const voteResult = z.object({
  feedbackId: z.string().openapi({
    description:
      "The vote's handle; an anonymous visitor needs it to add a reason",
  }),
  helpful: z.boolean(),
  changed: z.boolean(),
});
export const voteEvent = (
  { params }: { params: { articleId: string } },
  result: z.output<typeof voteResult>,
) =>
  result.changed && {
    type: "help_center.article_feedback_recorded" as const,
    entityType: "article" as const,
    entityId: params.articleId,
    payload: { helpful: String(result.helpful), source: "visitor" },
  };

export async function recordVote(
  db: Db,
  viewer: Viewer,
  articleId: KbArticleId,
  principalId: QuillsCaller["principalId"],
  helpful: boolean,
) {
  // The article row lock serializes the caller's votes and the count updates. PostgreSQL takes
  // no schema-qualified `FOR ... OF`, so the lock reads the article alone, then checks it.
  await db
    .select({ id: helpCenterArticles.id })
    .from(helpCenterArticles)
    .where(eq(helpCenterArticles.id, articleId))
    .for("no key update");
  const [target] = await db
    .select({ id: helpCenterArticles.id })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      eq(helpCenterCategories.id, helpCenterArticles.categoryId),
    )
    .where(
      and(
        eq(helpCenterArticles.id, articleId),
        visibleArticle(viewer.segmentIds),
      ),
    );
  if (!target) throw notFound("Article");
  const [existing] = principalId
    ? await db
        .select({
          id: helpCenterArticleFeedback.id,
          helpful: helpCenterArticleFeedback.helpful,
        })
        .from(helpCenterArticleFeedback)
        .where(
          and(
            eq(helpCenterArticleFeedback.articleId, articleId),
            eq(helpCenterArticleFeedback.principalId, principalId),
          ),
        )
    : [];
  if (existing?.helpful === helpful)
    return { feedbackId: existing.id, helpful, changed: false };
  if (existing)
    await db
      .update(helpCenterArticleFeedback)
      .set({ helpful, reason: null })
      .where(eq(helpCenterArticleFeedback.id, existing.id));
  const [created] = existing
    ? []
    : await db
        .insert(helpCenterArticleFeedback)
        .values({ articleId, principalId, helpful })
        .onConflictDoNothing()
        .returning({ id: helpCenterArticleFeedback.id });
  if (!existing && !created)
    throw new HTTPException(409, { message: "A concurrent vote; retry" });
  // A new vote adds one; a changed vote also takes one from the other count.
  const delta = (column: AnyColumn, gains: boolean) =>
    gains ? sql`${column} + 1` : existing ? sql`${column} - 1` : undefined;
  await db
    .update(helpCenterArticles)
    .set({
      helpfulCount: delta(helpCenterArticles.helpfulCount, helpful),
      notHelpfulCount: delta(helpCenterArticles.notHelpfulCount, !helpful),
    })
    .where(eq(helpCenterArticles.id, articleId));
  return { feedbackId: (existing ?? created)!.id, helpful, changed: true };
}
