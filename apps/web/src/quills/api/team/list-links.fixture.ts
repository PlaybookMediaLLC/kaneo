import type { ListLinksResponse } from "./list-links";
export const listLinksFixture = {
  ok: (overrides: Partial<ListLinksResponse> = {}) =>
    ({
      ...{ nextOffset: null, boards: [], posts: [] },
      ...overrides,
    }) satisfies ListLinksResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
