import type { GetPublicStatusPageResponse } from "./get-public-status-page";
export const getPublicStatusPageFixture = {
  ok: (overrides: Partial<GetPublicStatusPageResponse> = {}) =>
    ({
      ...{
        pageDescription: null,
        topLevelStatus: "operational",
        activeIncidentCount: 0,
        groups: [],
        ungroupedComponents: [],
        activeIncidents: [],
        upcomingMaintenance: [],
        recentIncidents: [],
        recentWindow: { start: "2026-01-01T00:00:00.000Z", days: 0 },
        uptime: [],
      },
      ...overrides,
    }) satisfies GetPublicStatusPageResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
