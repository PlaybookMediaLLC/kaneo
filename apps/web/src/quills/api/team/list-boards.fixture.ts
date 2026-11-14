import type { ListBoardsResponse } from "./list-boards";
export const listBoardsFixture = {
  ok: (overrides: Partial<ListBoardsResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListBoardsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
