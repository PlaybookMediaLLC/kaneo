import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { updateBoardSettings } from "./update-board-settings";
import { updateBoardSettingsFixture } from "./update-board-settings.fixture";
describe("updateBoardSettings", () => {
  describeOperationContract({
    operationId: "updateQuillsBoardSettings",
    operation: updateBoardSettings,
    request: {
      param: { workspaceId: "workspace_test_1", boardId: "board-id_test_1" },
      json: {},
    },
    response: updateBoardSettingsFixture.ok(),
    method: "patch",
    path: "/api/quills/workspace_test_1/boards/board-id_test_1/settings",
    statuses: [401, 403, 404, 429],
  });
});
