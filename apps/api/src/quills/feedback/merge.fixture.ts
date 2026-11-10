import { fixture } from "../framework/contract";
import { byParam, feedbackSeed, type FeedbackIds } from "./seeds.fixture";

export const getQuillsPostMergePreview = fixture({
  seed: feedbackSeed,
  valid: ({ a }: FeedbackIds) => ({
    params: { postId: a.duplicatePostId },
    query: { into: a.canonicalPostId },
  }),
  foreign: ({ b }: FeedbackIds) => ({ postId: b.duplicatePostId }),
});
export const mergeQuillsPost = fixture({
  seed: feedbackSeed,
  valid: ({ a }: FeedbackIds) => ({
    params: { postId: a.duplicatePostId },
    body: { canonicalPostId: a.canonicalPostId },
  }),
  foreign: ({ b }: FeedbackIds) => ({
    postId: b.duplicatePostId,
    canonicalPostId: b.canonicalPostId,
  }),
});
export const unmergeQuillsPost = byParam("postId", (s) => s.mergedPostId);
export const listQuillsMergedPosts = byParam(
  "postId",
  (s) => s.canonicalPostId,
);
