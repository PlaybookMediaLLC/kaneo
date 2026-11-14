import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPostBoardFixture } from "../../api/team/set-post-board.fixture";
import { useSetPostBoard } from "./use-set-post-board";
describe("useSetPostBoard", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPostBoard,
    operationId: "setQuillsPostBoard",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { boardId: "board_id_test_1" },
    },
    response: setPostBoardFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPost",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPostFilterCounts",
      ),
    ],
  });
});
