import type { ListTagsResponse } from "./list-tags";
export const listTagsFixture = {
  ok: (overrides: Partial<ListTagsResponse> = {}) =>
    ({
      ...{ tags: [], nextOffset: null },
      ...overrides,
    }) satisfies ListTagsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
