import type { GetUserCompanyResponse } from "./get-user-company";
export const getUserCompanyFixture = {
  ok: (overrides: Partial<GetUserCompanyResponse> = {}) =>
    ({ ...{ company: null }, ...overrides }) satisfies GetUserCompanyResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
