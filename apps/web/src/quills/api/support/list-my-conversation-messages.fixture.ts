import type { ListMyConversationMessagesResponse } from "./list-my-conversation-messages";
export const listMyConversationMessagesFixture = {
  ok: (overrides: Partial<ListMyConversationMessagesResponse> = {}) =>
    ({
      ...{ items: [], hasMore: false },
      ...overrides,
    }) satisfies ListMyConversationMessagesResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
