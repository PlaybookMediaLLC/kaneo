import type { EditPortalOwnPostResponse } from "./edit-portal-own-post";
export const editPortalOwnPostFixture = {
  ok: (overrides: Partial<EditPortalOwnPostResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        title: "value",
        content: "value",
        board: { id: "id_test_1", name: "value", slug: "value" },
        status: null,
        stage: "open",
        author: { name: null, avatarUrl: null, isTeamMember: false },
        voteCount: 0,
        commentCount: 0,
        pending: false,
        isAuthor: false,
        voted: false,
        following: false,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }) satisfies EditPortalOwnPostResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
