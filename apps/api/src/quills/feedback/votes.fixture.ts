import { fixture } from "../framework/contract";
import { customerVote, seed, softDeletePost, type Ids } from "./seed.fixture";

const onPost = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { postId: a.postId } }),
  foreign: ({ b }: Ids) => ({ postId: b.postId }),
  softDelete: softDeletePost,
});
const onVoter = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId, principalId: a.customerId },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, principalId: b.customerId }),
  softDelete: softDeletePost,
});

export const listQuillsPostVoters = { ...onPost, seed: customerVote };
export const voteQuillsPost = onPost;
export const addQuillsPostProxyVote = onVoter;
export const removeQuillsPostVote = { ...onVoter, seed: customerVote };
