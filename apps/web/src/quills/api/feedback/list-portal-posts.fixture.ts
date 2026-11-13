import type { ListPortalPostsResponse } from "./list-portal-posts";
export const listPortalPostsFixture = {
  ok: (overrides: Partial<ListPortalPostsResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null, hasMore: false },
      ...overrides,
    }) satisfies ListPortalPostsResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
