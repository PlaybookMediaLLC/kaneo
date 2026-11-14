import { empty, fixture } from "../framework/contract";
import { customerVote, seed, softDeletePost, type Ids } from "./seed.fixture";

export const getQuillsPostDemand = fixture({
  seed: customerVote,
  valid: ({ a }: Ids) => ({ params: { postId: a.postId } }),
  foreign: ({ b }: Ids) => ({ postId: b.postId }),
  softDelete: softDeletePost,
});
export const getQuillsRevenueAtRisk = { ...empty, seed };
