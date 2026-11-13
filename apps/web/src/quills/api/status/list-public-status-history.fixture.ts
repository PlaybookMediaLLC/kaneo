import type { ListPublicStatusHistoryResponse } from "./list-public-status-history";
export const listPublicStatusHistoryFixture = {
  ok: (overrides: Partial<ListPublicStatusHistoryResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null },
      ...overrides,
    }) satisfies ListPublicStatusHistoryResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
