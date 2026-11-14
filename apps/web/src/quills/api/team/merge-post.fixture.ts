import type { MergePostResponse } from "./merge-post";
export const mergePostFixture = {
  ok: (overrides: Partial<MergePostResponse> = {}) =>
    ({
      ...{
        canonicalPost: { id: "id_test_1", voteCount: 0 },
        duplicatePost: { id: "id_test_1" },
      },
      ...overrides,
    }) satisfies MergePostResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
