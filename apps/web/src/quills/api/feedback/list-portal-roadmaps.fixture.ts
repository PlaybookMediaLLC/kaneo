import type { ListPortalRoadmapsResponse } from "./list-portal-roadmaps";
export const listPortalRoadmapsFixture = {
  ok: (overrides: Partial<ListPortalRoadmapsResponse> = {}) =>
    ({
      ...{ roadmaps: [] },
      ...overrides,
    }) satisfies ListPortalRoadmapsResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
