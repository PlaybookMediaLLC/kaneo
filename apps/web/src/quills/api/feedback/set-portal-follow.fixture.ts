import type { SetPortalFollowResponse } from "./set-portal-follow";
export const setPortalFollowFixture = {
  ok: (overrides: Partial<SetPortalFollowResponse> = {}) =>
    ({
      ...{ postId: "post_id_test_1", following: false },
      ...overrides,
    }) satisfies SetPortalFollowResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
