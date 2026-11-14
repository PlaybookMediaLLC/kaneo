import type { ListConversationAttributesResponse } from "./list-conversation-attributes";
export const listConversationAttributesFixture = {
  ok: (overrides: Partial<ListConversationAttributesResponse> = {}) =>
    ({
      ...{ items: [] },
      ...overrides,
    }) satisfies ListConversationAttributesResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
