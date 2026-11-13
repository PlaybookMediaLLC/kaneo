import type { ValidateCsatEmailTokenResponse } from "./validate-csat-email-token";
export const validateCsatEmailTokenFixture = {
  ok: (overrides: Partial<ValidateCsatEmailTokenResponse> = {}) =>
    ({ valid: true, ...overrides }) satisfies ValidateCsatEmailTokenResponse,
  problem: (status: 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
