import type { PreviewUnsubscribeTokenResponse } from "./preview-unsubscribe-token";
export const previewUnsubscribeTokenFixture = {
  ok: (overrides: Partial<PreviewUnsubscribeTokenResponse> = {}) =>
    ({
      ...{ valid: false, action: "unsubscribe_post", postTitle: "value" },
      ...overrides,
    }) satisfies PreviewUnsubscribeTokenResponse,
  problem: (status: 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
