import type { ListSegmentsResponse } from "./list-segments";
export const listSegmentsFixture = {
  ok: (overrides: Partial<ListSegmentsResponse> = {}) =>
    ({ ...{ segments: [] }, ...overrides }) satisfies ListSegmentsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
