import type { GetLinkedConversationsForPostResponse } from "./get-linked-conversations-for-post";
export const getLinkedConversationsForPostFixture = {
  ok: (overrides: Partial<GetLinkedConversationsForPostResponse> = {}) =>
    ({
      ...{ items: [] },
      ...overrides,
    }) satisfies GetLinkedConversationsForPostResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
