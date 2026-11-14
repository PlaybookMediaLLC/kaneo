import type { MarkConversationReadResponse } from "./mark-conversation-read";
export const markConversationReadFixture = {
  ok: (overrides: Partial<MarkConversationReadResponse> = {}) =>
    ({
      ...{
        conversationId: "conversation_id_test_1",
        agentLastReadAt: null,
        changed: false,
      },
      ...overrides,
    }) satisfies MarkConversationReadResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
