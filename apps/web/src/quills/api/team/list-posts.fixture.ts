import type { ListPostsResponse } from "./list-posts";
export const listPostsFixture = {
  ok: (overrides: Partial<ListPostsResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null, hasMore: false },
      ...overrides,
    }) satisfies ListPostsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
