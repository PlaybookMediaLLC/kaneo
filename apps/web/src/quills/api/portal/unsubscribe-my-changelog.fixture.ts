import type { UnsubscribeMyChangelogResponse } from "./unsubscribe-my-changelog";
export const unsubscribeMyChangelogFixture = {
  ok: (overrides: Partial<UnsubscribeMyChangelogResponse> = {}) =>
    ({
      ...{ changed: false },
      ...overrides,
    }) satisfies UnsubscribeMyChangelogResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
