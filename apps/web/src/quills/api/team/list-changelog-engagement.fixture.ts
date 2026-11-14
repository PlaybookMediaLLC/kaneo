import type { ListChangelogEngagementResponse } from "./list-changelog-engagement";
export const listChangelogEngagementFixture = {
  ok: (overrides: Partial<ListChangelogEngagementResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListChangelogEngagementResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
