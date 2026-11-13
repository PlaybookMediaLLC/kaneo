import type { SearchPublicHelpCenterResponse } from "./search-public-help-center";
export const searchPublicHelpCenterFixture = {
  ok: (overrides: Partial<SearchPublicHelpCenterResponse> = {}) =>
    ({
      ...{ locale: "value", articles: [] },
      ...overrides,
    }) satisfies SearchPublicHelpCenterResponse,
  problem: (status: 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
