import type { CreateMyTicketResponse } from "./create-my-ticket";
export const createMyTicketFixture = {
  ok: (overrides: Partial<CreateMyTicketResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        number: 0,
        reference: "value",
        title: "value",
        stage: "received",
        stageLabel: null,
        ticketType: null,
        conversationId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
        resolvedAt: null,
      },
      ...overrides,
    }) satisfies CreateMyTicketResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
