import type { ListPortalStatusesResponse } from "./list-portal-statuses";
export const listPortalStatusesFixture = {
  ok: (overrides: Partial<ListPortalStatusesResponse> = {}) =>
    ({ ...{ items: [] }, ...overrides }) satisfies ListPortalStatusesResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
