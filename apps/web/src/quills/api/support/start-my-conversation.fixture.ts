import type { StartMyConversationResponse } from "./start-my-conversation";
export const startMyConversationFixture = {
  ok: (overrides: Partial<StartMyConversationResponse> = {}) =>
    ({
      ...{
        message: {
          id: "id_test_1",
          conversationId: "conversation_id_test_1",
          fromVisitor: false,
          senderType: "visitor",
          author: null,
          content: "value",
          embeds: [],
          attachments: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          editedAt: null,
        },
        conversation: {
          id: "id_test_1",
          status: "open",
          isReadOnly: false,
          subject: null,
          preview: null,
          lastMessageAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          unreadCount: 0,
          csatRating: null,
          csatSubmittedAt: null,
        },
        replayed: false,
      },
      ...overrides,
    }) satisfies StartMyConversationResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
