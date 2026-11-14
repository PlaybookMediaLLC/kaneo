import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getBoardSettingsFixture } from "../../api/team/get-board-settings.fixture";
import { useGetBoardSettings } from "./use-get-board-settings";
describe("useGetBoardSettings", () => {
  describeHookContract({
    kind: "query",
    hook: useGetBoardSettings,
    operationId: "getQuillsBoardSettings",
    request: {
      param: { workspaceId: "workspace_test_1", boardId: "board-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", boardId: "board-id_test_1" } },
    response: getBoardSettingsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
