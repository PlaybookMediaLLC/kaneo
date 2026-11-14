import type { GetMyWeeklyDigestPreferenceResponse } from "./get-my-weekly-digest-preference";
export const getMyWeeklyDigestPreferenceFixture = {
  ok: (overrides: Partial<GetMyWeeklyDigestPreferenceResponse> = {}) =>
    ({
      ...{ weeklyDigest: false },
      ...overrides,
    }) satisfies GetMyWeeklyDigestPreferenceResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
