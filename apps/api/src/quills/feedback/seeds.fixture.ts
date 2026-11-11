import { eq, sql } from "drizzle-orm";
import { toUuid } from "@kaneo/ids";
import { boards } from "../../database/quills/schema/boards";
import { postComments, posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { fixture, type ContractEnv } from "../framework/contract";

// Seed helpers shared by the feedback fixtures and feature tests. Not fixtures themselves.

/** A fixture `softDelete` hook: sets deleted_at on the row of quills.`table` in A that `pick` names. */
export const softDeletes =
  <T>(table: string, pick: (ids: T) => string) =>
  (env: ContractEnv, ids: T) =>
    env.db.execute(
      sql`UPDATE quills.${sql.identifier(table)} SET deleted_at = now() WHERE workspace_id = ${env.a} AND id = ${toUuid(pick(ids))}::uuid`,
    );

/** A fresh status in one workspace. */
export const statusIn = async (env: ContractEnv, workspaceId: string) => {
  const slug = env.id("status");
  const [row] = await env.scoped(workspaceId, (db) =>
    db
      .insert(postStatuses)
      .values({ name: slug, slug, category: "active" })
      .returning({ id: postStatuses.id }),
  );
  return row!.id;
};

/** A fresh board and a post by the workspace owner on it. */
export const postIn = (
  env: ContractEnv,
  workspaceId: string,
  values: Partial<typeof posts.$inferInsert> = {},
) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Contract", slug: env.id("board") })
      .returning({ id: boards.id });
    const [post] = await db
      .insert(posts)
      .values({
        title: "Contract post",
        content: "Contract",
        boardId: board!.id,
        principalId: actor.principalId,
        ...values,
      })
      .returning({ id: posts.id });
    return { boardId: board!.id, postId: post!.id };
  });

/** A pending post, a published post with a pending comment and a merged pair. */
async function feedbackSide(env: ContractEnv, workspaceId: string) {
  const pending = await postIn(env, workspaceId, {
    moderationState: "pending",
  });
  const canonical = await postIn(env, workspaceId);
  const duplicate = await postIn(env, workspaceId);
  const merged = await postIn(env, workspaceId);
  return env.scoped(workspaceId, async (db, actor) => {
    const [comment] = await db
      .insert(postComments)
      .values({
        postId: canonical.postId,
        principalId: actor.principalId,
        content: "Held",
        moderationState: "pending",
      })
      .returning({ id: postComments.id });
    await db
      .update(posts)
      .set({ canonicalPostId: canonical.postId, mergedAt: new Date() })
      .where(eq(posts.id, merged.postId));
    return {
      pendingPostId: pending.postId,
      commentId: comment!.id,
      canonicalPostId: canonical.postId,
      duplicatePostId: duplicate.postId,
      mergedPostId: merged.postId,
    };
  });
}
export const feedbackSeed = async (env: ContractEnv) => ({
  a: await feedbackSide(env, env.a),
  b: await feedbackSide(env, env.b),
});
export type FeedbackIds = Awaited<ReturnType<typeof feedbackSeed>>;

/** A fixture whose one path parameter names a seeded row in A, and the same row in B. */
export const byParam = (
  param: string,
  pick: (ids: FeedbackIds["a"]) => string,
  body?: object,
) =>
  fixture({
    seed: feedbackSeed,
    valid: ({ a }: FeedbackIds) => ({ params: { [param]: pick(a) }, body }),
    foreign: ({ b }: FeedbackIds) => ({ [param]: pick(b) }),
  });
