import type { SetMyWeeklyDigestPreferenceResponse } from "./set-my-weekly-digest-preference";
export const setMyWeeklyDigestPreferenceFixture = {
  ok: (overrides: Partial<SetMyWeeklyDigestPreferenceResponse> = {}) =>
    ({
      ...{ weeklyDigest: false },
      ...overrides,
    }) satisfies SetMyWeeklyDigestPreferenceResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
