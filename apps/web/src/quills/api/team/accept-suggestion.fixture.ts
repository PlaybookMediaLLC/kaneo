import type { AcceptSuggestionResponse } from "./accept-suggestion";
export const acceptSuggestionFixture = {
  ok: (overrides: Partial<AcceptSuggestionResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        duplicatePostId: "duplicate_post_id_test_1",
        canonicalPostId: "canonical_post_id_test_1",
        canonicalVoteCount: 0,
      },
      ...overrides,
    }) satisfies AcceptSuggestionResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
