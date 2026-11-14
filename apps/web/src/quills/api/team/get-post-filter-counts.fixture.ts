import type { GetPostFilterCountsResponse } from "./get-post-filter-counts";
export const getPostFilterCountsFixture = {
  ok: (overrides: Partial<GetPostFilterCountsResponse> = {}) =>
    ({
      ...{ statuses: [], boards: [], tags: [], deleted: 0 },
      ...overrides,
    }) satisfies GetPostFilterCountsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
