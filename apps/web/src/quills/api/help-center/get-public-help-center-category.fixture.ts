import type { GetPublicHelpCenterCategoryResponse } from "./get-public-help-center-category";
export const getPublicHelpCenterCategoryFixture = {
  ok: (overrides: Partial<GetPublicHelpCenterCategoryResponse> = {}) =>
    ({
      ...{
        canonicalPath: "value",
        category: {
          id: "id_test_1",
          urlId: 0,
          slug: "value",
          name: "value",
          description: null,
          icon: null,
          parentId: null,
          articleCount: 0,
          path: "value",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        articles: [],
        subcategories: [],
        categories: [],
      },
      ...overrides,
    }) satisfies GetPublicHelpCenterCategoryResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
