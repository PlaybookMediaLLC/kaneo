import type { CreatePostFromConversationResponse } from "./create-post-from-conversation";
export const createPostFromConversationFixture = {
  ok: (overrides: Partial<CreatePostFromConversationResponse> = {}) =>
    ({
      ...{
        postId: "post_id_test_1",
        created: false,
        voted: false,
        messageId: "message_id_test_1",
      },
      ...overrides,
    }) satisfies CreatePostFromConversationResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
