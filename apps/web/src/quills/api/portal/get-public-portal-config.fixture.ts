import type { GetPublicPortalConfigResponse } from "./get-public-portal-config";
export const getPublicPortalConfigFixture = {
  ok: (overrides: Partial<GetPublicPortalConfigResponse> = {}) =>
    ({
      ...{
        name: "value",
        features: {
          allowAnonymous: false,
          allowEditAfterEngagement: false,
          allowDeleteAfterEngagement: false,
          showPublicEditHistory: false,
        },
        portalAccess: { isPrivate: false },
        branding: {
          logoUrl: "value",
          theme: { themeMode: "light", light: {}, dark: {} },
          headerDisplayMode: "logo_and_name",
          headerDisplayName: "value",
        },
      },
      ...overrides,
    }) satisfies GetPublicPortalConfigResponse,
  problem: (status: 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
