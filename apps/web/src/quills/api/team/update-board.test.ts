import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { updateBoard } from "./update-board";
import { updateBoardFixture } from "./update-board.fixture";
describe("updateBoard", () => {
  describeOperationContract({
    operationId: "updateQuillsBoard",
    operation: updateBoard,
    request: {
      param: { workspaceId: "workspace_test_1", boardId: "board-id_test_1" },
      json: {},
    },
    response: updateBoardFixture.ok(),
    method: "patch",
    path: "/api/quills/workspace_test_1/boards/board-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
