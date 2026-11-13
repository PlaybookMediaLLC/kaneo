import type { GetMyLanguagePreferenceResponse } from "./get-my-language-preference";
export const getMyLanguagePreferenceFixture = {
  ok: (overrides: Partial<GetMyLanguagePreferenceResponse> = {}) =>
    ({
      ...{ language: null },
      ...overrides,
    }) satisfies GetMyLanguagePreferenceResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
