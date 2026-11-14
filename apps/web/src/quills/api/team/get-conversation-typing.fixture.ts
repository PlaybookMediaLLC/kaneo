import type { GetConversationTypingResponse } from "./get-conversation-typing";
export const getConversationTypingFixture = {
  ok: (overrides: Partial<GetConversationTypingResponse> = {}) =>
    ({
      ...{ visitorTyping: false },
      ...overrides,
    }) satisfies GetConversationTypingResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
