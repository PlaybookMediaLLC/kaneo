import type { ListUsersResponse } from "./list-users";
export const listUsersFixture = {
  ok: (overrides: Partial<ListUsersResponse> = {}) =>
    ({
      ...{ items: [], total: 0, nextOffset: null },
      ...overrides,
    }) satisfies ListUsersResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
