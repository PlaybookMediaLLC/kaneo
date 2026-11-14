import type { FetchAdminOverviewResponse } from "./fetch-admin-overview";
export const fetchAdminOverviewFixture = {
  ok: (overrides: Partial<FetchAdminOverviewResponse> = {}) =>
    ({
      ...{
        support: { waitingCount: 0, waiting: [] },
        feedback: {
          reviewCount: 0,
          completeCount: 0,
          review: [],
          announce: [],
        },
        momentum: [],
        changelog: { drafts: [] },
        helpCenter: { draftCount: 0, drafts: [] },
        status: { openIncidentCount: 0, subscriberCount: 0 },
      },
      ...overrides,
    }) satisfies FetchAdminOverviewResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
