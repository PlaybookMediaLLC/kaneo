import type { UpdateBoardSettingsResponse } from "./update-board-settings";
export const updateBoardSettingsFixture = {
  ok: (overrides: Partial<UpdateBoardSettingsResponse> = {}) =>
    ({
      ...{
        boardId: "board_id_test_1",
        voteDisplay: "count",
        defaultSort: "votes",
      },
      ...overrides,
    }) satisfies UpdateBoardSettingsResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
