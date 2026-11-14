import type { TranslatePortalContentResponse } from "./translate-portal-content";
export const translatePortalContentFixture = {
  ok: (overrides: Partial<TranslatePortalContentResponse> = {}) =>
    ({
      ...{ title: null, content: "value" },
      ...overrides,
    }) satisfies TranslatePortalContentResponse,
  problem: (status: 403 | 404 | 409 | 429 | 502) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
