import { fixture } from "../framework/contract";
import { seed, softDeletePost, type Ids } from "./seed.fixture";

export const setQuillsPostScore = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId },
    body: { reach: 100, impact: 2, confidence: 80, effort: 4 },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId }),
  softDelete: softDeletePost,
});
