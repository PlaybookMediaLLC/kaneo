import { fixture } from "../framework/contract";
import {
  deleteComment,
  pinComment,
  seed,
  teammateReactions,
  type Ids,
} from "./seed.fixture";

const onComment = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { commentId: a.commentId } }),
  foreign: ({ b }: Ids) => ({ commentId: b.commentId }),
});
const onPin = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId, commentId: a.commentId },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, commentId: b.commentId }),
});
const withEmoji = (ids: Ids) => ({
  ...onComment.valid(ids),
  query: { emoji: "👍" },
});

export const listQuillsPostComments = fixture({
  seed: teammateReactions,
  valid: ({ a }: Ids) => ({ params: { postId: a.postId } }),
  foreign: ({ b }: Ids) => ({ postId: b.postId }),
});
export const getQuillsComment = onComment;
export const createQuillsComment = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId },
    body: { content: "A reply", parentId: a.commentId },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, parentId: b.commentId }),
});
export const updateQuillsComment = fixture({
  ...onComment,
  valid: (ids: Ids) => ({
    ...onComment.valid(ids),
    body: { content: "Edited" },
  }),
});
export const deleteQuillsComment = onComment;
export const restoreQuillsComment = { ...onComment, seed: deleteComment };
export const setQuillsCommentPin = onPin;
export const removeQuillsCommentPin = { ...onPin, seed: pinComment };
export const setQuillsCommentReaction = { ...onComment, valid: withEmoji };
export const removeQuillsCommentReaction = {
  ...onComment,
  seed: teammateReactions,
  valid: withEmoji,
};
