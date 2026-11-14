import type { UnmergePostResponse } from "./unmerge-post";
export const unmergePostFixture = {
  ok: (overrides: Partial<UnmergePostResponse> = {}) =>
    ({
      ...{
        post: { id: "id_test_1" },
        canonicalPost: { id: "id_test_1", voteCount: 0 },
      },
      ...overrides,
    }) satisfies UnmergePostResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
