import type { ListConversationTagsResponse } from "./list-conversation-tags";
export const listConversationTagsFixture = {
  ok: (overrides: Partial<ListConversationTagsResponse> = {}) =>
    ({ ...{ items: [] }, ...overrides }) satisfies ListConversationTagsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
