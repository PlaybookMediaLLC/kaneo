import type { ListPortalPostCommentsResponse } from "./list-portal-post-comments";
type PortalComment = ListPortalPostCommentsResponse["items"][number];
export const listPortalPostCommentsFixture = {
  comment: (overrides: Partial<PortalComment> = {}) =>
    ({
      attachments: [],
      id: "comment_test_1",
      parentId: null,
      content: "A useful reply",
      author: { name: "Morgan", avatarUrl: null, isTeamMember: false },
      isAuthor: false,
      canEdit: false,
      canDelete: false,
      pending: false,
      deleted: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
      reactions: [],
      ...overrides,
    }) satisfies PortalComment,
  ok: (overrides: Partial<ListPortalPostCommentsResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListPortalPostCommentsResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
