import type { SetPostTagsResponse } from "./set-post-tags";
export const setPostTagsFixture = {
  ok: (overrides: Partial<SetPostTagsResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        boardId: "board_id_test_1",
        title: "value",
        content: "value",
        statusId: null,
        principalId: "principal_id_test_1",
        authorName: null,
        ownerPrincipalId: null,
        voteCount: 0,
        commentCount: 0,
        pinnedCommentId: null,
        isCommentsLocked: false,
        moderationState: "value",
        canonicalPostId: null,
        eta: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
        tags: [],
        score: {
          reach: null,
          impact: null,
          confidence: null,
          effort: null,
          rice: null,
        },
      },
      ...overrides,
    }) satisfies SetPostTagsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
