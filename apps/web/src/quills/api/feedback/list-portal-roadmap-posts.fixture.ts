import type { ListPortalRoadmapPostsResponse } from "./list-portal-roadmap-posts";
export const listPortalRoadmapPostsFixture = {
  ok: (overrides: Partial<ListPortalRoadmapPostsResponse> = {}) =>
    ({
      ...{ items: [], total: 0, hasMore: false, buckets: null },
      ...overrides,
    }) satisfies ListPortalRoadmapPostsResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
