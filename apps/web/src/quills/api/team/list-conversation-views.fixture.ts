import type { ListConversationViewsResponse } from "./list-conversation-views";
export const listConversationViewsFixture = {
  ok: (overrides: Partial<ListConversationViewsResponse> = {}) =>
    ({
      ...{ items: [] },
      ...overrides,
    }) satisfies ListConversationViewsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
