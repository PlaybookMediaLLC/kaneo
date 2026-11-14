import type { ListPostVotersResponse } from "./list-post-voters";
export const listPostVotersFixture = {
  ok: (overrides: Partial<ListPostVotersResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListPostVotersResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
