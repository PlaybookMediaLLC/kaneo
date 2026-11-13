import type { ListPortalChangelogResponse } from "./list-portal-changelog";
export const listPortalChangelogFixture = {
  ok: (overrides: Partial<ListPortalChangelogResponse> = {}) =>
    ({
      ...{ entries: [], nextOffset: null },
      ...overrides,
    }) satisfies ListPortalChangelogResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
