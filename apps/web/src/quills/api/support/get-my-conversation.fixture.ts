import type { GetMyConversationResponse } from "./get-my-conversation";
export const getMyConversationFixture = {
  ok: (overrides: Partial<GetMyConversationResponse> = {}) =>
    ({
      ...{
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
        messages: [],
        hasMore: false,
        teamTyping: false,
      },
      ...overrides,
    }) satisfies GetMyConversationResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
