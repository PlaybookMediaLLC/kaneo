import type { BlockUserResponse } from "./block-user";
export const blockUserFixture = {
  ok: (overrides: Partial<BlockUserResponse> = {}) =>
    ({ ...{ blockedAt: null }, ...overrides }) satisfies BlockUserResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
