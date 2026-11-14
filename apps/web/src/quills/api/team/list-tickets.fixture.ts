import type { ListTicketsResponse } from "./list-tickets";
export const listTicketsFixture = {
  ok: (overrides: Partial<ListTicketsResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null, hasMore: false },
      ...overrides,
    }) satisfies ListTicketsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
