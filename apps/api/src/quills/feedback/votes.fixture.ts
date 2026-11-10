import { fixture } from "../framework/contract";
import { customerVote, seed, type Ids } from "./seed.fixture";

const onPost = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { postId: a.postId } }),
  foreign: ({ b }: Ids) => ({ postId: b.postId }),
});
const onVoter = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId, principalId: a.customerId },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, principalId: b.customerId }),
});

export const listQuillsPostVoters = { ...onPost, seed: customerVote };
export const voteQuillsPost = onPost;
export const addQuillsPostProxyVote = onVoter;
export const removeQuillsPostVote = { ...onVoter, seed: customerVote };
