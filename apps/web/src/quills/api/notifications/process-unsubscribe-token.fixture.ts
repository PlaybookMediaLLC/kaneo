import type { ProcessUnsubscribeTokenResponse } from "./process-unsubscribe-token";
export const processUnsubscribeTokenFixture = {
  ok: (overrides: Partial<ProcessUnsubscribeTokenResponse> = {}) =>
    ({
      ...{ processed: false, action: "unsubscribe_post", postTitle: "value" },
      ...overrides,
    }) satisfies ProcessUnsubscribeTokenResponse,
  problem: (status: 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
