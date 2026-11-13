import type { GetPublicStatusUptimeResponse } from "./get-public-status-uptime";
export const getPublicStatusUptimeFixture = {
  ok: (overrides: Partial<GetPublicStatusUptimeResponse> = {}) =>
    ({
      ...{ series: [] },
      ...overrides,
    }) satisfies GetPublicStatusUptimeResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
