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
import { boards } from "../../database/quills/schema/boards";
import {
  postComments,
  postVotes,
  posts,
} from "../../database/quills/schema/posts";
import type { Database } from "../framework/define-route";
import { notTest } from "./visibility";

// A merged post's votes and comments stay on it and count on its canonical post (merge.ts).

/** The post and the live posts merged into it, on live boards. */
const threadIds = (db: Database, ...ids: PostId[]) =>
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
export async function uniqueVoters(db: Database, ...ids: PostId[]) {
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
export async function recount(
  db: Database,
  id: PostId,
  resetMergeCheck = false,
) {
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

/**
 * Locks a post and the post that it is merged into, in ID order as merge.ts does, and returns that
 * canonical post's ID (or null). Call it before the first write to the post, then `recount` the
 * canonical post after the write: a merge, unmerge or count change on the pair cannot deadlock
 * with it, and no parallel count is lost.
 */
export async function lockMergeTarget(db: Database, postId: PostId) {
  // A merge or unmerge can commit between the read and the lock; read again until they agree.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({ target: posts.canonicalPostId })
      .from(posts)
      .where(eq(posts.id, postId));
    const target = row?.target ?? null;
    const locked = await db
      .select({ id: posts.id, target: posts.canonicalPostId })
      .from(posts)
      .where(inArray(posts.id, target ? [postId, target] : [postId]))
      .orderBy(asc(posts.id))
      .for("update");
    const post = locked.find((candidate) => candidate.id === postId);
    if ((post?.target ?? null) === target) return target;
  }
  throw new HTTPException(409, {
    message: "The post changed; reload it and try again",
  });
}

/**
 * Recounts the canonical posts of the live merged posts that match `merged`, after a change that
 * locks none of those merged posts (a board delete). The canonical posts are locked in ID order.
 */
export async function recountMergeTargets(db: Database, merged: SQL) {
  const targets = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      inArray(
        posts.id,
        db
          .select({ id: posts.canonicalPostId })
          .from(posts)
          .where(and(merged, isNull(posts.deletedAt))),
      ),
    )
    .orderBy(asc(posts.id))
    .for("update");
  for (const target of targets) await recount(db, target.id);
}
