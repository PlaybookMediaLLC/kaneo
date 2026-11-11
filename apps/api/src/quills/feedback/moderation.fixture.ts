import { fixture } from "../framework/contract";
import {
  byParam,
  feedbackSeed,
  softDeletes,
  type FeedbackIds,
} from "./seeds.fixture";

const pendingPost = softDeletes(
  "posts",
  ({ a }: FeedbackIds) => a.pendingPostId,
);
const pendingComment = softDeletes(
  "post_comments",
  ({ a }: FeedbackIds) => a.commentId,
);

export const listQuillsPendingModeration = fixture({
  seed: feedbackSeed,
  valid: () => ({ query: { type: "comment" } }),
});
export const getQuillsModerationStatus = fixture({
  seed: feedbackSeed,
  valid: () => ({}),
});
export const approveQuillsPost = {
  ...byParam("postId", (s) => s.pendingPostId),
  softDelete: pendingPost,
};
export const rejectQuillsPost = {
  ...byParam("postId", (s) => s.pendingPostId, { reason: "Spam" }),
  softDelete: pendingPost,
};
export const approveQuillsComment = {
  ...byParam("commentId", (s) => s.commentId),
  softDelete: pendingComment,
};
export const rejectQuillsComment = {
  ...byParam("commentId", (s) => s.commentId, { reason: "" }),
  softDelete: pendingComment,
};
export const setQuillsModerationDefault = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { requireApproval: "all", holdLinks: true } }),
});
