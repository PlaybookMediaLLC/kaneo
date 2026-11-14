import type { AddConversationNoteResponse } from "./add-conversation-note";
export const addConversationNoteFixture = {
  ok: (overrides: Partial<AddConversationNoteResponse> = {}) =>
    ({
      ...{
        message: {
          id: "id_test_1",
          conversationId: "conversation_id_test_1",
          senderType: "visitor",
          isInternal: false,
          authorPrincipalId: null,
          authorName: null,
          content: "value",
          systemKind: null,
          embeds: [],
          attachments: [],
          reactions: [],
          flaggedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          editedAt: null,
        },
      },
      ...overrides,
    }) satisfies AddConversationNoteResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
