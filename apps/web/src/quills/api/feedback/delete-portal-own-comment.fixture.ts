import type { DeletePortalOwnCommentResponse } from "./delete-portal-own-comment";
export const deletePortalOwnCommentFixture = {
  ok: (overrides: Partial<DeletePortalOwnCommentResponse> = {}) =>
    ({
      ...{ id: "id_test_1", postId: "post_id_test_1" },
      ...overrides,
    }) satisfies DeletePortalOwnCommentResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
