import type { SetPortalVoteResponse } from "./set-portal-vote";
export const setPortalVoteFixture = {
  ok: (overrides: Partial<SetPortalVoteResponse> = {}) =>
    ({
      ...{
        postId: "post_id_test_1",
        voted: false,
        voteCount: 0,
        changed: false,
        importance: null,
      },
      ...overrides,
    }) satisfies SetPortalVoteResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
