import { fixture } from "../framework/contract";
import { byParam, feedbackSeed } from "./seeds.fixture";

export const listQuillsPendingModeration = fixture({
  seed: feedbackSeed,
  valid: () => ({ query: { type: "comment" } }),
});
export const getQuillsModerationStatus = fixture({
  seed: feedbackSeed,
  valid: () => ({}),
});
export const approveQuillsPost = byParam("postId", (s) => s.pendingPostId);
export const rejectQuillsPost = byParam("postId", (s) => s.pendingPostId, {
  reason: "Spam",
});
export const approveQuillsComment = byParam("commentId", (s) => s.commentId);
export const rejectQuillsComment = byParam("commentId", (s) => s.commentId, {
  reason: "",
});
export const setQuillsModerationDefault = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { requireApproval: "all", holdLinks: true } }),
});
