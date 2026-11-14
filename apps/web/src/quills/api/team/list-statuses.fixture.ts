import type { ListStatusesResponse } from "./list-statuses";
export const listStatusesFixture = {
  ok: (overrides: Partial<ListStatusesResponse> = {}) =>
    ({
      ...{ statuses: [], nextOffset: null },
      ...overrides,
    }) satisfies ListStatusesResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
