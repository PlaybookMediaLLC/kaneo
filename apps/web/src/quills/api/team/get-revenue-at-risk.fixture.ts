import type { GetRevenueAtRiskResponse } from "./get-revenue-at-risk";
export const getRevenueAtRiskFixture = {
  ok: (overrides: Partial<GetRevenueAtRiskResponse> = {}) =>
    ({
      ...{ companies: 0, mrrCents: 0 },
      ...overrides,
    }) satisfies GetRevenueAtRiskResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
