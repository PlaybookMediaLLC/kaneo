import type { ListPortalBoardsResponse } from "./list-portal-boards";
export const listPortalBoardsFixture = {
  ok: (overrides: Partial<ListPortalBoardsResponse> = {}) =>
    ({ ...{ items: [] }, ...overrides }) satisfies ListPortalBoardsResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
