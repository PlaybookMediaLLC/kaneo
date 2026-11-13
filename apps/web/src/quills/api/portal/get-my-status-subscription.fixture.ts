import type { GetMyStatusSubscriptionResponse } from "./get-my-status-subscription";
export const getMyStatusSubscriptionFixture = {
  ok: (overrides: Partial<GetMyStatusSubscriptionResponse> = {}) =>
    ({
      ...{
        subscribed: false,
        scope: "page",
        componentIds: [],
        unsubscribedAt: null,
      },
      ...overrides,
    }) satisfies GetMyStatusSubscriptionResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
