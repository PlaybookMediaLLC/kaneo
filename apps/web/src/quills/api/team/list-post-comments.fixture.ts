import type { ListPostCommentsResponse } from "./list-post-comments";
export const listPostCommentsFixture = {
  ok: (overrides: Partial<ListPostCommentsResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListPostCommentsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
