import type { GetMyChangelogSubscriptionResponse } from "./get-my-changelog-subscription";
export const getMyChangelogSubscriptionFixture = {
  ok: (overrides: Partial<GetMyChangelogSubscriptionResponse> = {}) =>
    ({
      ...{ subscribed: false },
      ...overrides,
    }) satisfies GetMyChangelogSubscriptionResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
