import type { GetTeamCountsResponse } from "./get-team-counts";
export const getTeamCountsFixture = {
  ok: (overrides: Partial<GetTeamCountsResponse> = {}) =>
    ({
      ...{
        myConversations: 0,
        unassignedConversations: 0,
        openConversations: 0,
        openTickets: 0,
        pendingDuplicates: 0,
        pendingSignals: 0,
      },
      ...overrides,
    }) satisfies GetTeamCountsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
