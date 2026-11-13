import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalBoards } from "./list-portal-boards";
import { listPortalBoardsFixture } from "./list-portal-boards.fixture";
describe("listPortalBoards", () => {
  describeOperationContract({
    operationId: "listQuillsPortalBoards",
    operation: listPortalBoards,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalBoardsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/boards",
    statuses: [403, 404],
  });
});
