import { eq, isNotNull, ne } from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import { boards, postTags } from "../../database/quills/schema/boards";
import {
  postCommentReactions,
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import type { ContractEnv } from "../framework/contract";
import { softDeletes } from "./seeds.fixture";

/** Feedback rows in one workspace: two boards, a post with a comment, a tag, a customer and two statuses. */
export async function side(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db, actor) => {
    const [board, otherBoard] = await db
      .insert(boards)
      .values([
        { name: "Contract", slug: env.id("board") },
        { name: "Other", slug: env.id("board") },
      ])
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.isDefault, true));
    const [otherStatus] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(ne(postStatuses.isDefault, true));
    const [tag] = await db
      .insert(postTags)
      .values({ name: env.id("tag") })
      .returning({ id: postTags.id });
    const [customer] = await db
      .insert(principal)
      .values({
        type: "user",
        role: "user",
        displayName: "Customer",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const [post] = await db
      .insert(posts)
      .values({
        title: "Contract",
        content: "Contract",
        boardId: board!.id,
        principalId: actor.principalId,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    const [comment] = await db
      .insert(postComments)
      .values({
        postId: post!.id,
        principalId: actor.principalId,
        content: "Contract",
        isTeamMember: true,
      })
      .returning({ id: postComments.id });
    return {
      boardId: board!.id,
      otherBoardId: otherBoard!.id,
      statusId: status!.id,
      otherStatusId: otherStatus!.id,
      tagId: tag!.id,
      customerId: customer!.id,
      ownerId: actor.principalId,
      postId: post!.id,
      commentId: comment!.id,
    };
  });
}

export const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
export type Ids = Awaited<ReturnType<typeof seed>>;

/** Both workspaces, then extra state in A. */
export const seedWith =
  (
    extra: (
      ...args: [...Parameters<Parameters<ContractEnv["scoped"]>[1]>, Ids["a"]]
    ) => Promise<unknown>,
  ) =>
  async (env: ContractEnv) => {
    const ids = await seed(env);
    await env.scoped(env.a, (db, actor) => extra(db, actor, ids.a));
    return ids;
  };

/** Fixture `softDelete` hooks for A's seeded board, post and comment. */
export const softDeleteBoard = softDeletes("boards", ({ a }: Ids) => a.boardId);
export const softDeletePost = softDeletes("posts", ({ a }: Ids) => a.postId);
export const softDeleteComment = softDeletes(
  "post_comments",
  ({ a }: Ids) => a.commentId,
);

export const deletePost = seedWith((db, _actor, a) =>
  db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, a.postId)),
);
export const deleteComment = seedWith((db, _actor, a) =>
  db
    .update(postComments)
    .set({ deletedAt: new Date() })
    .where(eq(postComments.id, a.commentId)),
);
export const customerVote = seedWith((db, _actor, a) =>
  db.insert(postVotes).values({ postId: a.postId, principalId: a.customerId }),
);
export const pinComment = seedWith((db, _actor, a) =>
  db
    .update(posts)
    .set({ pinnedCommentId: a.commentId })
    .where(eq(posts.id, a.postId)),
);
/** A 👍 from every teammate of A, so the caller always has a reaction to remove. */
export const teammateReactions = seedWith(async (db, _actor, a) => {
  const teammates = await db
    .select({ id: principal.id })
    .from(principal)
    .where(isNotNull(principal.kaneoUserId));
  await db.insert(postCommentReactions).values(
    teammates.map((t) => ({
      commentId: a.commentId,
      principalId: t.id,
      emoji: "👍",
    })),
  );
});
