import type { FindPortalSimilarPostsResponse } from "./find-portal-similar-posts";
export const findPortalSimilarPostsFixture = {
  ok: (overrides: Partial<FindPortalSimilarPostsResponse> = {}) =>
    ({
      ...{ items: [] },
      ...overrides,
    }) satisfies FindPortalSimilarPostsResponse,
  problem: (status: 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
