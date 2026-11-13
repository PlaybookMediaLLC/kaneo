import type { SendMyConversationMessageResponse } from "./send-my-conversation-message";
export const sendMyConversationMessageFixture = {
  ok: (overrides: Partial<SendMyConversationMessageResponse> = {}) =>
    ({
      ...{
        message: {
          id: "id_test_1",
          conversationId: "conversation_id_test_1",
          fromVisitor: false,
          senderType: "visitor",
          author: { name: "value", avatarUrl: "value" },
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
          subject: "value",
          preview: "value",
          lastMessageAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          unreadCount: 0,
          csatRating: null,
          csatSubmittedAt: null,
        },
        replayed: false,
      },
      ...overrides,
    }) satisfies SendMyConversationMessageResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
