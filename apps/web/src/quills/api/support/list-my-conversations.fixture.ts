import type { ListMyConversationsResponse } from "./list-my-conversations";
export const listMyConversationsFixture = {
  ok: (overrides: Partial<ListMyConversationsResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null },
      ...overrides,
    }) satisfies ListMyConversationsResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
