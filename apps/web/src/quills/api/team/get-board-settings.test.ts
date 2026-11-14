import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getBoardSettings } from "./get-board-settings";
import { getBoardSettingsFixture } from "./get-board-settings.fixture";
describe("getBoardSettings", () => {
  describeOperationContract({
    operationId: "getQuillsBoardSettings",
    operation: getBoardSettings,
    request: {
      param: { workspaceId: "workspace_test_1", boardId: "board-id_test_1" },
    },
    response: getBoardSettingsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/boards/board-id_test_1/settings",
    statuses: [401, 403, 404, 429],
  });
});
