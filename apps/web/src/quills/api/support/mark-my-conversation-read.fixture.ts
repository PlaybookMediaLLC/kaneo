import type { MarkMyConversationReadResponse } from "./mark-my-conversation-read";
export const markMyConversationReadFixture = {
  ok: (overrides: Partial<MarkMyConversationReadResponse> = {}) =>
    ({
      ...{ unreadCount: 0, changed: false },
      ...overrides,
    }) satisfies MarkMyConversationReadResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
