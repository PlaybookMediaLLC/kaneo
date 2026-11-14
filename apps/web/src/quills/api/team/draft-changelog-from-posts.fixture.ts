import type { DraftChangelogFromPostsResponse } from "./draft-changelog-from-posts";
export const draftChangelogFromPostsFixture = {
  ok: (overrides: Partial<DraftChangelogFromPostsResponse> = {}) =>
    ({
      ...{ title: "value", body: "value", postIds: [], requesterCount: 0 },
      ...overrides,
    }) satisfies DraftChangelogFromPostsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429 | 502) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
