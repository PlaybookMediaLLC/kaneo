import type { GetPortalChangelogEntryResponse } from "./get-portal-changelog-entry";
export const getPortalChangelogEntryFixture = {
  ok: (overrides: Partial<GetPortalChangelogEntryResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        title: "value",
        content: "value",
        publishedAt: "2026-01-01T00:00:00.000Z",
        author: null,
        categories: [],
        linkedPosts: [],
        requesterCount: 0,
        reactions: [],
        unread: false,
      },
      ...overrides,
    }) satisfies GetPortalChangelogEntryResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
