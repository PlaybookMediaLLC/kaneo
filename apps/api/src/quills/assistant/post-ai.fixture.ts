import { empty, fixture } from "../framework/contract";
import { seedPosts, type PostIds } from "./seed.fixture";

const onPost = (query?: Record<string, string>) =>
  fixture({
    seed: seedPosts,
    valid: ({ a }: PostIds) => ({
      params: { postId: a.postId },
      ...(query && { query }),
    }),
    foreign: ({ b }: PostIds) => ({ postId: b.postId }),
  });

export const listQuillsSimilarPosts = onPost({ limit: "5" });
export const getQuillsPostSentiment = onPost();
export const requestQuillsPostSentiment = onPost();
export const requestQuillsPostTagBackfill = fixture({
  seed: seedPosts,
  valid: ({ a }: PostIds) => ({ body: { boardId: a.boardId, limit: 5 } }),
  foreign: ({ b }: PostIds) => ({ boardId: b.boardId }),
});
export const requestQuillsEmbeddingBackfill = empty;
