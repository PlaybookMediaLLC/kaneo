import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { nullableResponseTimestamp, responseTimestamp, z } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards, postTags } from "../../database/quills/schema/boards";
import { posts, postTagAssignments } from "../../database/quills/schema/posts";
import type { Database } from "../framework/define-route";

export const postSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  title: z.string(),
  content: z.string(),
  statusId: z.string().nullable(),
  principalId: z.string(),
  authorName: z.string().nullable(),
  ownerPrincipalId: z.string().nullable(),
  voteCount: z.number(),
  commentCount: z.number(),
  pinnedCommentId: z.string().nullable(),
  isCommentsLocked: z.boolean(),
  moderationState: z.string(),
  canonicalPostId: z.string().nullable(),
  eta: nullableResponseTimestamp,
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  deletedAt: nullableResponseTimestamp,
  tags: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string() }),
  ),
  score: z.object({
    reach: z.number().nullable(),
    impact: z.number().nullable(),
    confidence: z.number().nullable(),
    effort: z.number().nullable(),
    rice: z.number().nullable().openapi({
      description:
        "reach × impact × confidence ÷ 100 ÷ effort. Null when an input is missing.",
    }),
  }),
});

type Score = {
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
};

/** The RICE score (RFC 0003, D5), or null when an input is missing. The table keeps effort above 0. */
export const riceOf = (s: Score) =>
  s.reach === null ||
  s.impact === null ||
  s.confidence === null ||
  s.effort === null
    ? null
    : (s.reach * s.impact * s.confidence) / 100 / s.effort;

const fields = {
  id: posts.id,
  boardId: posts.boardId,
  title: posts.title,
  content: posts.content,
  statusId: posts.statusId,
  principalId: posts.principalId,
  authorName: principal.displayName,
  ownerPrincipalId: posts.ownerPrincipalId,
  voteCount: posts.voteCount,
  commentCount: posts.commentCount,
  pinnedCommentId: posts.pinnedCommentId,
  isCommentsLocked: posts.isCommentsLocked,
  moderationState: posts.moderationState,
  canonicalPostId: posts.canonicalPostId,
  eta: posts.eta,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
  deletedAt: posts.deletedAt,
  score: {
    reach: posts.scoreReach,
    impact: posts.scoreImpact,
    confidence: posts.scoreConfidence,
    effort: posts.scoreEffort,
  },
};

/** Posts joined to their board and author. The caller adds filters, order and limit. */
export const selectPosts = (db: Database, where: SQL | undefined) =>
  db
    .select(fields)
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(principal, eq(principal.id, posts.principalId))
    .where(where)
    .$dynamic();

type Row = Awaited<
  ReturnType<ReturnType<typeof selectPosts>["execute"]>
>[number];

/** Adds the active tags of each post, with one query for the page. */
export async function withTags(db: Database, rows: Row[]) {
  const ids = rows.map((row) => row.id);
  const tags = ids.length
    ? await db
        .select({
          postId: postTagAssignments.postId,
          id: postTags.id,
          name: postTags.name,
          color: postTags.color,
        })
        .from(postTagAssignments)
        .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
        .where(
          and(
            inArray(postTagAssignments.postId, ids),
            isNull(postTags.deletedAt),
          ),
        )
        .orderBy(postTags.name)
    : [];
  return rows.map((row) => ({
    ...row,
    score: { ...row.score, rice: riceOf(row.score) },
    tags: tags
      .filter((tag) => tag.postId === row.id)
      .map(({ id, name, color }) => ({ id, name, color })),
  }));
}

/** One post in the response shape. The caller has already checked access. */
export async function loadPost(db: Database, id: TypeId<"post">) {
  const [post] = await withTags(
    db,
    await selectPosts(db, eq(posts.id, id)).limit(1),
  );
  return post!;
}
