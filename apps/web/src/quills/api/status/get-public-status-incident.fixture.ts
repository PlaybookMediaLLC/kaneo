import type { GetPublicStatusIncidentResponse } from "./get-public-status-incident";
export const getPublicStatusIncidentFixture = {
  ok: (overrides: Partial<GetPublicStatusIncidentResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        kind: "incident",
        title: "value",
        status: "investigating",
        impact: "none",
        scheduledStartAt: "2026-01-01T00:00:00.000Z",
        scheduledEndAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        resolvedAt: "2026-01-01T00:00:00.000Z",
        affectedComponents: [],
        updates: [],
      },
      ...overrides,
    }) satisfies GetPublicStatusIncidentResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
