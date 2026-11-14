import type { ListPublicHelpCenterCategoryArticlesResponse } from "./list-public-help-center-category-articles";
export const listPublicHelpCenterCategoryArticlesFixture = {
  ok: (overrides: Partial<ListPublicHelpCenterCategoryArticlesResponse> = {}) =>
    ({
      ...{ articles: [] },
      ...overrides,
    }) satisfies ListPublicHelpCenterCategoryArticlesResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
