import type { RemovePostVoteResponse } from "./remove-post-vote";
export const removePostVoteFixture = {
  ok: (overrides: Partial<RemovePostVoteResponse> = {}) =>
    ({
      ...{ postId: "post_id_test_1", changed: false, voteCount: 0 },
      ...overrides,
    }) satisfies RemovePostVoteResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
