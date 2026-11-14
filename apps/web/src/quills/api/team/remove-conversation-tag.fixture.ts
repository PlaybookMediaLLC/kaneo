import type { RemoveConversationTagResponse } from "./remove-conversation-tag";
export const removeConversationTagFixture = {
  ok: (overrides: Partial<RemoveConversationTagResponse> = {}) =>
    ({
      ...{ conversationId: "conversation_id_test_1", changed: false, tags: [] },
      ...overrides,
    }) satisfies RemoveConversationTagResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
