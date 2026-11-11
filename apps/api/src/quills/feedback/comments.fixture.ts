import { postComments } from "../../database/quills/schema/posts";
import { fixture } from "../framework/contract";
import {
  deleteComment,
  pinComment,
  seed,
  softDeleteComment,
  softDeletePost,
  teammateReactions,
  type Ids,
} from "./seed.fixture";

const onComment = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { commentId: a.commentId } }),
  foreign: ({ b }: Ids) => ({ commentId: b.commentId }),
  softDelete: softDeleteComment,
});
const onPin = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId, commentId: a.commentId },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, commentId: b.commentId }),
  softDelete: softDeleteComment,
});
const withEmoji = (ids: Ids) => ({
  ...onComment.valid(ids),
  query: { emoji: "👍" },
});

export const listQuillsPostComments = fixture({
  seed: teammateReactions,
  valid: ({ a }: Ids) => ({ params: { postId: a.postId } }),
  foreign: ({ b }: Ids) => ({ postId: b.postId }),
  softDelete: softDeletePost,
});
export const getQuillsComment = onComment;
export const createQuillsComment = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId },
    body: { content: "A reply", parentId: a.commentId },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, parentId: b.commentId }),
  softDelete: softDeletePost,
});
export const updateQuillsComment = fixture({
  ...onComment,
  valid: (ids: Ids) => ({
    ...onComment.valid(ids),
    body: { content: "Edited" },
  }),
});
// The caller's own comment: the declared update action deletes it. own-records.test.ts covers another person's.
export const deleteQuillsComment = fixture({
  ...onComment,
  seed: async (env, caller) => {
    const ids = await seed(env);
    const [own] = await env.scoped(
      env.a,
      (db, actor) =>
        db
          .insert(postComments)
          .values({
            postId: ids.a.postId,
            principalId: actor.principalId,
            content: "Own",
            isTeamMember: true,
          })
          .returning({ id: postComments.id }),
      caller,
    );
    return { ...ids, a: { ...ids.a, commentId: own!.id } };
  },
});
// Their targets are a deleted comment: restore needs one, and a deleted comment can still be unpinned.
export const restoreQuillsComment = {
  ...onComment,
  seed: deleteComment,
  softDelete: undefined,
};
export const setQuillsCommentPin = onPin;
export const removeQuillsCommentPin = {
  ...onPin,
  seed: pinComment,
  softDelete: undefined,
};
export const setQuillsCommentReaction = { ...onComment, valid: withEmoji };
export const removeQuillsCommentReaction = {
  ...onComment,
  seed: teammateReactions,
  valid: withEmoji,
};
