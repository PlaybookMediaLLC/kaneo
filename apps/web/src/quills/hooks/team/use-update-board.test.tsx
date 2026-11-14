import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { updateBoardFixture } from "../../api/team/update-board.fixture";
import { useUpdateBoard } from "./use-update-board";
describe("useUpdateBoard", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUpdateBoard,
    operationId: "updateQuillsBoard",
    request: {
      param: { workspaceId: "workspace_test_1", boardId: "board-id_test_1" },
      json: {},
    },
    response: updateBoardFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listBoards",
      ),
    ],
  });
});
