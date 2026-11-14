import type { GetTicketResponse } from "./get-ticket";
export const getTicketFixture = {
  ok: (overrides: Partial<GetTicketResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        number: 0,
        reference: "value",
        type: "customer",
        ticketType: null,
        title: "value",
        status: {
          id: "id_test_1",
          name: "value",
          color: "value",
          category: "open",
        },
        stage: { slot: "received", label: null, closed: false },
        priority: "none",
        requester: null,
        assignee: {
          principalId: null,
          displayName: null,
          teamId: null,
          teamName: null,
        },
        company: null,
        customAttributes: [],
        firstResponseAt: null,
        dueAt: null,
        resolvedAt: null,
        reopenedCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }) satisfies GetTicketResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
