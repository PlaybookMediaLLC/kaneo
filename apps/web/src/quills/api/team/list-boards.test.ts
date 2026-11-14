import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listBoards } from "./list-boards";
import { listBoardsFixture } from "./list-boards.fixture";
describe("listBoards", () => {
  describeOperationContract({
    operationId: "listQuillsBoards",
    operation: listBoards,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listBoardsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/boards",
    statuses: [401, 403, 404, 409, 429],
  });
});
