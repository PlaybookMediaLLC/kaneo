import { fixture } from "../framework/contract";
import {
  byParam,
  feedbackSeed,
  softDeletes,
  type FeedbackIds,
} from "./seeds.fixture";

const deletedPost = (pick: (ids: FeedbackIds["a"]) => string) =>
  softDeletes("posts", ({ a }: FeedbackIds) => pick(a));

export const getQuillsPostMergePreview = fixture({
  seed: feedbackSeed,
  valid: ({ a }: FeedbackIds) => ({
    params: { postId: a.duplicatePostId },
    query: { into: a.canonicalPostId },
  }),
  foreign: ({ b }: FeedbackIds) => ({ postId: b.duplicatePostId }),
  softDelete: deletedPost((a) => a.duplicatePostId),
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
  softDelete: deletedPost((a) => a.duplicatePostId),
});
export const unmergeQuillsPost = {
  ...byParam("postId", (s) => s.mergedPostId),
  softDelete: deletedPost((a) => a.mergedPostId),
};
export const listQuillsMergedPosts = {
  ...byParam("postId", (s) => s.canonicalPostId),
  softDelete: deletedPost((a) => a.canonicalPostId),
};
