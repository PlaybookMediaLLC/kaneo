import type { SendConversationTypingResponse } from "./send-conversation-typing";
export const sendConversationTypingFixture = {
  ok: (overrides: Partial<SendConversationTypingResponse> = {}) =>
    ({
      ...{ ok: true },
      ...overrides,
    }) satisfies SendConversationTypingResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
