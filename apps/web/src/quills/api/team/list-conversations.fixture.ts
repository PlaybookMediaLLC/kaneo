import type { ListConversationsResponse } from "./list-conversations";
export const listConversationsFixture = {
  ok: (overrides: Partial<ListConversationsResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null, hasMore: false },
      ...overrides,
    }) satisfies ListConversationsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
