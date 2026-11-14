import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { updateBoardSettingsFixture } from "../../api/team/update-board-settings.fixture";
import { useUpdateBoardSettings } from "./use-update-board-settings";
describe("useUpdateBoardSettings", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUpdateBoardSettings,
    operationId: "updateQuillsBoardSettings",
    request: {
      param: { workspaceId: "workspace_test_1", boardId: "board-id_test_1" },
      json: {},
    },
    response: updateBoardSettingsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getBoardSettings",
      ),
    ],
  });
});
