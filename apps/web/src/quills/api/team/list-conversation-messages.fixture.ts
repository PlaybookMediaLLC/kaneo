import type { ListConversationMessagesResponse } from "./list-conversation-messages";
export const listConversationMessagesFixture = {
  ok: (overrides: Partial<ListConversationMessagesResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null, hasMore: false },
      ...overrides,
    }) satisfies ListConversationMessagesResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
