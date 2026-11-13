import type { GetMyTicketsResponse } from "./get-my-tickets";
export const getMyTicketsFixture = {
  ok: (overrides: Partial<GetMyTicketsResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null },
      ...overrides,
    }) satisfies GetMyTicketsResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
