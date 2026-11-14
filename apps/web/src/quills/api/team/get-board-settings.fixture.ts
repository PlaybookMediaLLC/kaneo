import type { GetBoardSettingsResponse } from "./get-board-settings";
export const getBoardSettingsFixture = {
  ok: (overrides: Partial<GetBoardSettingsResponse> = {}) =>
    ({
      ...{
        boardId: "board_id_test_1",
        voteDisplay: "count",
        defaultSort: "votes",
      },
      ...overrides,
    }) satisfies GetBoardSettingsResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
