import type { UnsubscribeStatusResponse } from "./unsubscribe-status";
export const unsubscribeStatusFixture = {
  ok: (overrides: Partial<UnsubscribeStatusResponse> = {}) =>
    ({
      ...{
        subscribed: false,
        scope: "page",
        componentIds: [],
        unsubscribedAt: null,
        changed: false,
      },
      ...overrides,
    }) satisfies UnsubscribeStatusResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
