import type { GetTeamCountsResponse } from "./get-team-counts";
export const getTeamCountsFixture = {
  ok: (overrides: Partial<GetTeamCountsResponse> = {}) =>
    ({
      ...{
        myConversations: 0,
        unassignedConversations: 0,
        openConversations: 0,
        queueConversations: 0,
        openTickets: 0,
        pendingDuplicates: 0,
        pendingSignals: 0,
        postStatuses: [
          {
            id: "post_status_test_1",
            name: "Under review",
            color: "gray",
            count: 0,
          },
        ],
      },
      ...overrides,
    }) satisfies GetTeamCountsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
