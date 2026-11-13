import type { CreatePortalCommentResponse } from "./create-portal-comment";
export const createPortalCommentFixture = {
  ok: (overrides: Partial<CreatePortalCommentResponse> = {}) =>
    ({
      ...{
        attachments: [],
        id: "id_test_1",
        parentId: null,
        content: "value",
        author: { name: null, avatarUrl: null, isTeamMember: false },
        isAuthor: true,
        canEdit: true,
        canDelete: true,
        pending: false,
        deleted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
        reactions: [],
        postId: "post_id_test_1",
        replayed: false,
      },
      ...overrides,
    }) satisfies CreatePortalCommentResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
