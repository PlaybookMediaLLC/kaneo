import type { AddPostProxyVoteResponse } from "./add-post-proxy-vote";
export const addPostProxyVoteFixture = {
  ok: (overrides: Partial<AddPostProxyVoteResponse> = {}) =>
    ({
      ...{ postId: "post_id_test_1", changed: false, voteCount: 0 },
      ...overrides,
    }) satisfies AddPostProxyVoteResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
