import type { CreatePortalPostResponse } from "./create-portal-post";
export const createPortalPostFixture = {
  ok: (overrides: Partial<CreatePortalPostResponse> = {}) =>
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
        replayed: false,
      },
      ...overrides,
    }) satisfies CreatePortalPostResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
