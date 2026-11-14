import type { GetLinkedPostsForConversationResponse } from "./get-linked-posts-for-conversation";
export const getLinkedPostsForConversationFixture = {
  ok: (overrides: Partial<GetLinkedPostsForConversationResponse> = {}) =>
    ({
      ...{ items: [] },
      ...overrides,
    }) satisfies GetLinkedPostsForConversationResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
