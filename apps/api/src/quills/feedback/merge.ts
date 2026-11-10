import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { postActivity } from "../../database/quills/schema/activity";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import {
  postComments,
  postVotes,
  posts,
} from "../../database/quills/schema/posts";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { page, pageQuery } from "./schemas";
import { loadProjects, notTest, visibleBoard, visiblePost } from "./visibility";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

// Merge links a duplicate to its canonical post, as in Quackback's post.merge.ts:
// votes and comments stay on the duplicate and count on the canonical post.

const params = z.object({ postId: flexibleToTypeIdSchema("post") });
const notFound = () => new HTTPException(404, { message: "Post not found" });
const conflict = (message: string) => new HTTPException(409, { message });

/** The post and the live posts merged into it, on live boards. */
const threadIds = (db: Db, ...ids: PostId[]) =>
  db
    .select({ id: posts.id })
    .from(posts)
    .where(
      or(
        inArray(posts.id, ids),
        and(
          inArray(posts.canonicalPostId, ids),
          isNull(posts.deletedAt),
          sql`exists (select 1 from ${boards} where ${eq(boards.id, posts.boardId)} and ${isNull(boards.deletedAt)})`,
        ),
      ),
    );

/** Unique non-test voters across the threads. */
async function uniqueVoters(db: Db, ...ids: PostId[]) {
  const [row] = await db
    .select({ n: countDistinct(postVotes.principalId) })
    .from(postVotes)
    .where(
      and(
        inArray(postVotes.postId, threadIds(db, ...ids)),
        notTest(postVotes.principalId),
      ),
    );
  return row!.n;
}

/** Stores the unique voter and public comment counts of a post's thread. */
async function recount(db: Db, id: PostId, resetMergeCheck = false) {
  const voteCount = await uniqueVoters(db, id);
  const [comments] = await db
    .select({ n: count() })
    .from(postComments)
    .where(
      and(
        inArray(postComments.postId, threadIds(db, id)),
        isNull(postComments.deletedAt),
        notTest(postComments.principalId),
        eq(postComments.isPrivate, false),
        ne(postComments.moderationState, "pending"),
      ),
    );
  await db
    .update(posts)
    .set({
      voteCount,
      commentCount: comments!.n,
      ...(resetMergeCheck && { mergeCheckedAt: null }),
    })
    .where(eq(posts.id, id));
  return voteCount;
}

/** Locks the posts in ID order, so two merges over the same posts cannot deadlock. */
const lockPosts = (db: Db, ids: PostId[], where: SQL) =>
  db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      canonicalPostId: posts.canonicalPostId,
    })
    .from(posts)
    .where(and(inArray(posts.id, ids), where))
    .orderBy(asc(posts.id))
    .for("update");

const summary = z.object({
  id: z.string(),
  title: z.string(),
  voteCount: z.number(),
  commentCount: z.number(),
  boardId: z.string(),
  boardName: z.string(),
  canonicalPostId: z.string().nullable(),
});

const preview = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/merge-preview",
  operationId: "getQuillsPostMergePreview",
  summary: "Preview a merge of this post into another post",
  description:
    "Both posts must be visible to the caller. The merged vote count counts each voter once.",
  action: "read",
  params,
  query: z.object({ into: flexibleToTypeIdSchema("post") }),
  load: loadProjects,
  response: z.object({
    duplicate: summary,
    canonical: summary,
    mergedVoteCount: z.number(),
    mergedCommentCount: z.number(),
  }),
  responseDescription: "Both posts and the counts after a merge",
  errors: { 404: "Post not found" },
  handler: async ({ db, params: { postId }, query: { into }, loaded }) => {
    if (postId === into)
      throw new HTTPException(400, {
        message: "A post cannot merge into itself",
      });
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        voteCount: posts.voteCount,
        commentCount: posts.commentCount,
        boardId: boards.id,
        boardName: boards.name,
        canonicalPostId: posts.canonicalPostId,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(inArray(posts.id, [postId, into]), visiblePost(loaded)));
    const duplicate = rows.find((row) => row.id === postId);
    const canonical = rows.find((row) => row.id === into);
    if (!duplicate || !canonical) throw notFound();
    return {
      duplicate,
      canonical,
      mergedVoteCount: await uniqueVoters(db, into, postId),
      mergedCommentCount: duplicate.commentCount + canonical.commentCount,
    };
  },
});

const mergePost = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/merge",
  operationId: "mergeQuillsPost",
  summary: "Merge this post into a canonical post",
  description:
    "One transaction: the link, both counts, the activity entries and post.merged. Both posts must be visible to the caller.",
  action: "update",
  params,
  body: z.object({ canonicalPostId: flexibleToTypeIdSchema("post") }),
  load: loadProjects,
  response: z.object({
    canonicalPost: z.object({ id: z.string(), voteCount: z.number() }),
    duplicatePost: z.object({ id: z.string() }),
  }),
  responseDescription: "The canonical post's new vote count",
  errors: {
    404: "Post not found",
    409: "A post is already merged, or the duplicate has merged posts",
  },
  event: ({ params, body }) => ({
    type: "post.merged",
    entityType: "post",
    entityId: params.postId,
    payload: { canonicalPostId: body.canonicalPostId },
  }),
  handler: async ({ db, actor, params: { postId }, body, loaded }) => {
    const { canonicalPostId } = body;
    if (postId === canonicalPostId)
      throw new HTTPException(400, {
        message: "A post cannot merge into itself",
      });
    const rows = await lockPosts(
      db,
      [postId, canonicalPostId],
      visiblePost(loaded),
    );
    const duplicate = rows.find((row) => row.id === postId);
    const canonical = rows.find((row) => row.id === canonicalPostId);
    if (!duplicate || !canonical) throw notFound();
    if (duplicate.canonicalPostId)
      throw conflict("This post is already merged. Unmerge it first.");
    if (canonical.canonicalPostId)
      throw conflict("Merge into the canonical post, not into a merged post");
    const [child] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.canonicalPostId, postId), isNull(posts.deletedAt)))
      .limit(1);
    if (child)
      throw conflict("A post with merged posts cannot itself be merged");
    await db
      .update(posts)
      .set({
        canonicalPostId,
        mergedAt: new Date(),
        mergedByPrincipalId: actor.principalId,
      })
      .where(eq(posts.id, postId));
    const voteCount = await recount(db, canonicalPostId, true);
    await db.insert(postActivity).values([
      {
        postId: canonicalPostId,
        principalId: actor.principalId,
        type: "post.merged_in",
        metadata: {
          duplicatePostId: postId,
          duplicatePostTitle: duplicate.title,
          duplicateVoteCount: duplicate.voteCount,
        },
      },
      {
        postId,
        principalId: actor.principalId,
        type: "post.merged_away",
        metadata: { canonicalPostId, canonicalPostTitle: canonical.title },
      },
    ]);
    return {
      canonicalPost: { id: canonicalPostId, voteCount },
      duplicatePost: { id: postId },
    };
  },
});

const unmergePost = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/unmerge",
  operationId: "unmergeQuillsPost",
  summary: "Make a merged post independent again",
  description:
    "One transaction: the link, both counts, the activity entries and post.unmerged.",
  action: "update",
  params,
  load: loadProjects,
  response: z.object({
    post: z.object({ id: z.string() }),
    canonicalPost: z.object({ id: z.string(), voteCount: z.number() }),
  }),
  responseDescription: "The canonical post's new vote count",
  errors: { 404: "Post not found", 409: "The post is not merged" },
  event: ({ params }, result) => ({
    type: "post.unmerged",
    entityType: "post",
    entityId: params.postId,
    payload: { canonicalPostId: result.canonicalPost.id },
  }),
  handler: async ({ db, actor, params: { postId }, loaded }) => {
    const [merged] = await db
      .select({ canonicalPostId: posts.canonicalPostId })
      .from(posts)
      .where(and(eq(posts.id, postId), visiblePost(loaded)));
    if (!merged) throw notFound();
    const canonicalPostId = merged.canonicalPostId;
    if (!canonicalPostId) throw conflict("This post is not merged");
    // The canonical post may since be deleted; it must still be on a board the caller can see.
    const rows = await lockPosts(
      db,
      [postId, canonicalPostId],
      visibleBoard(posts.boardId, loaded),
    );
    const post = rows.find((row) => row.id === postId);
    const canonical = rows.find((row) => row.id === canonicalPostId);
    if (!post || !canonical) throw notFound();
    if (post.canonicalPostId !== canonicalPostId)
      throw conflict("The post changed; reload it and try again");
    await db
      .update(posts)
      .set({
        canonicalPostId: null,
        mergedAt: null,
        mergedByPrincipalId: null,
        mergeCheckedAt: null,
      })
      .where(eq(posts.id, postId));
    const voteCount = await recount(db, canonicalPostId);
    await recount(db, postId);
    await db.insert(postActivity).values([
      {
        postId,
        principalId: actor.principalId,
        type: "post.unmerged",
        metadata: {
          otherPostId: canonicalPostId,
          otherPostTitle: canonical.title,
        },
      },
      {
        postId: canonicalPostId,
        principalId: actor.principalId,
        type: "post.unmerged",
        metadata: { otherPostId: postId, otherPostTitle: post.title },
      },
    ]);
    return {
      post: { id: postId },
      canonicalPost: { id: canonicalPostId, voteCount },
    };
  },
});

const listMerged = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/merged",
  operationId: "listQuillsMergedPosts",
  summary: "List the posts merged into a post",
  description: "Merged posts that the caller may see, oldest merge first.",
  action: "read",
  params,
  query: z.object(pageQuery),
  load: loadProjects,
  response: z.object({
    posts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        voteCount: z.number(),
        authorName: z.string().nullable(),
        createdAt: responseTimestamp,
        mergedAt: nullableResponseTimestamp,
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of merged posts",
  errors: { 404: "Post not found" },
  handler: async ({ db, params: { postId }, query, loaded }) => {
    const [canonical] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), visiblePost(loaded)));
    if (!canonical) throw notFound();
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        voteCount: db.$count(
          postVotes,
          and(eq(postVotes.postId, posts.id), notTest(postVotes.principalId)),
        ),
        authorName: principal.displayName,
        createdAt: posts.createdAt,
        mergedAt: posts.mergedAt,
      })
      .from(posts)
      .leftJoin(principal, eq(principal.id, posts.principalId))
      .where(and(eq(posts.canonicalPostId, postId), visiblePost(loaded)))
      .orderBy(asc(posts.mergedAt), asc(posts.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    const { items, nextOffset } = page(rows, query);
    return { posts: items, nextOffset };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...preview)
  .openapi(...mergePost)
  .openapi(...unmergePost)
  .openapi(...listMerged);
