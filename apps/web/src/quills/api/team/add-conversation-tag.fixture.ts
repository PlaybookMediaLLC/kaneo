import type { AddConversationTagResponse } from "./add-conversation-tag";
export const addConversationTagFixture = {
  ok: (overrides: Partial<AddConversationTagResponse> = {}) =>
    ({
      ...{ conversationId: "conversation_id_test_1", changed: false, tags: [] },
      ...overrides,
    }) satisfies AddConversationTagResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
