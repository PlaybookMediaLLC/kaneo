import type { DeletePortalOwnPostResponse } from "./delete-portal-own-post";
export const deletePortalOwnPostFixture = {
  ok: (overrides: Partial<DeletePortalOwnPostResponse> = {}) =>
    ({
      ...{ id: "id_test_1" },
      ...overrides,
    }) satisfies DeletePortalOwnPostResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
