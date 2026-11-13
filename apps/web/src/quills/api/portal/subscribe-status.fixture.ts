import type { SubscribeStatusResponse } from "./subscribe-status";
export const subscribeStatusFixture = {
  ok: (overrides: Partial<SubscribeStatusResponse> = {}) =>
    ({
      ...{
        subscribed: false,
        scope: "page",
        componentIds: [],
        unsubscribedAt: null,
        changed: false,
      },
      ...overrides,
    }) satisfies SubscribeStatusResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
