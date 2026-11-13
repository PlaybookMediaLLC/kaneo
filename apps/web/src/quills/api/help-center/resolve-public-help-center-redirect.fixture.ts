import type { ResolvePublicHelpCenterRedirectResponse } from "./resolve-public-help-center-redirect";
export const resolvePublicHelpCenterRedirectFixture = {
  ok: (overrides: Partial<ResolvePublicHelpCenterRedirectResponse> = {}) =>
    ({
      ...{ target: null },
      ...overrides,
    }) satisfies ResolvePublicHelpCenterRedirectResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
