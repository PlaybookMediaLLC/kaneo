import type { SetPortalCommentReactionResponse } from "./set-portal-comment-reaction";
export const setPortalCommentReactionFixture = {
  ok: (overrides: Partial<SetPortalCommentReactionResponse> = {}) =>
    ({
      ...{ commentId: "comment_id_test_1", changed: false, reactions: [] },
      ...overrides,
    }) satisfies SetPortalCommentReactionResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
