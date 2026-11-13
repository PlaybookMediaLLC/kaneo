import type { SubscribeMyChangelogResponse } from "./subscribe-my-changelog";
export const subscribeMyChangelogFixture = {
  ok: (overrides: Partial<SubscribeMyChangelogResponse> = {}) =>
    ({
      ...{ subscribed: false },
      ...overrides,
    }) satisfies SubscribeMyChangelogResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
