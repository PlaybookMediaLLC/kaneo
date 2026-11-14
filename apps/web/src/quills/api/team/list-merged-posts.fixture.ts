import type { ListMergedPostsResponse } from "./list-merged-posts";
export const listMergedPostsFixture = {
  ok: (overrides: Partial<ListMergedPostsResponse> = {}) =>
    ({
      ...{ posts: [], nextOffset: null },
      ...overrides,
    }) satisfies ListMergedPostsResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
