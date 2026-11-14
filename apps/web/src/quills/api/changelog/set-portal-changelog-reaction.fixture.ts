import type { SetPortalChangelogReactionResponse } from "./set-portal-changelog-reaction";
export const setPortalChangelogReactionFixture = {
  ok: (overrides: Partial<SetPortalChangelogReactionResponse> = {}) =>
    ({
      ...{ entryId: "entry_id_test_1", changed: false, reactions: [] },
      ...overrides,
    }) satisfies SetPortalChangelogReactionResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
