import type { GetPortalPostResponse } from "./get-portal-post";
export const getPortalPostFixture = {
  ok: (overrides: Partial<GetPortalPostResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        title: "value",
        content: "value",
        board: { id: "id_test_1", name: "value", slug: "value" },
        status: { id: "id_test_1", name: "value", color: "value" },
        stage: "open",
        author: { name: "value", avatarUrl: "value", isTeamMember: false },
        voteCount: 0,
        commentCount: 0,
        pending: false,
        isAuthor: false,
        voted: false,
        following: false,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        canVote: false,
        canComment: false,
        canEdit: false,
        canDelete: false,
        isCommentsLocked: false,
        authorOnlyReplies: false,
        mergedInto: { id: "id_test_1", title: "value" },
      },
      ...overrides,
    }) satisfies GetPortalPostResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
