import type { GetPublicHelpCenterArticleResponse } from "./get-public-help-center-article";
export const getPublicHelpCenterArticleFixture = {
  ok: (overrides: Partial<GetPublicHelpCenterArticleResponse> = {}) =>
    ({
      canonicalPath: "/hc/en/articles/1-getting-started",
      article: {
        id: "article_test_1",
        urlId: 1,
        slug: "getting-started",
        title: "Getting started",
        description: "A safe fixture article",
        path: "/hc/en/articles/1-getting-started",
        publishedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        author: { name: "Example author" },
        category: {
          id: "kb-category_test_1",
          urlId: 1,
          slug: "guides",
          name: "Guides",
        },
        content: "Safe fixture content",
      },
      articles: [],
      categories: [],
      ...overrides,
    }) satisfies GetPublicHelpCenterArticleResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
