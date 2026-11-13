import type { ListPortalVotedPostsResponse } from "./list-portal-voted-posts";
export const listPortalVotedPostsFixture = {
  ok: (overrides: Partial<ListPortalVotedPostsResponse> = {}) =>
    ({
      ...{ postIds: [] },
      ...overrides,
    }) satisfies ListPortalVotedPostsResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
