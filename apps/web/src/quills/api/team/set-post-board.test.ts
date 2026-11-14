import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPostBoard } from "./set-post-board";
import { setPostBoardFixture } from "./set-post-board.fixture";
describe("setPostBoard", () => {
  describeOperationContract({
    operationId: "setQuillsPostBoard",
    operation: setPostBoard,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { boardId: "board_id_test_1" },
    },
    response: setPostBoardFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/board",
    statuses: [401, 403, 404, 409, 429],
  });
});
