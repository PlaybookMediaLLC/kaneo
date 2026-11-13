import type { GetPublicHelpCenterResponse } from "./get-public-help-center";
export const getPublicHelpCenterFixture = {
  ok: (overrides: Partial<GetPublicHelpCenterResponse> = {}) =>
    ({
      ...{
        locale: "value",
        locales: [],
        homepageTitle: "value",
        homepageDescription: "value",
        searchPlaceholder: null,
        headerLinks: [],
        seo: {
          metaDescription: "value",
          indexable: false,
          structuredDataEnabled: false,
        },
        categories: [],
        popular: [],
      },
      ...overrides,
    }) satisfies GetPublicHelpCenterResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
