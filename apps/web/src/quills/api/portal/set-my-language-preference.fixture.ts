import type { SetMyLanguagePreferenceResponse } from "./set-my-language-preference";
export const setMyLanguagePreferenceFixture = {
  ok: (overrides: Partial<SetMyLanguagePreferenceResponse> = {}) =>
    ({
      ...{ language: null },
      ...overrides,
    }) satisfies SetMyLanguagePreferenceResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
