import type { AddTicketNoteResponse } from "./add-ticket-note";
export const addTicketNoteFixture = {
  ok: (overrides: Partial<AddTicketNoteResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        ticketId: null,
        conversationId: null,
        senderType: "visitor",
        isInternal: false,
        author: null,
        content: "value",
        systemEvent: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }) satisfies AddTicketNoteResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
