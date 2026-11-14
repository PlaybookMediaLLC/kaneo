import type { SearchShippedPostsResponse } from "./search-shipped-posts";
export const searchShippedPostsFixture = {
  ok: (overrides: Partial<SearchShippedPostsResponse> = {}) =>
    ({ ...{ posts: [] }, ...overrides }) satisfies SearchShippedPostsResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
