import type { UnblockUserResponse } from "./unblock-user";
export const unblockUserFixture = {
  ok: (overrides: Partial<UnblockUserResponse> = {}) =>
    ({ ...{ blockedAt: null }, ...overrides }) satisfies UnblockUserResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
