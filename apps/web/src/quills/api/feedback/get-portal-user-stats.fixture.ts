import type { GetPortalUserStatsResponse } from "./get-portal-user-stats";
export const getPortalUserStatsFixture = {
  ok: (overrides: Partial<GetPortalUserStatsResponse> = {}) =>
    ({
      ...{ posts: 0, comments: 0, votes: 0 },
      ...overrides,
    }) satisfies GetPortalUserStatsResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
