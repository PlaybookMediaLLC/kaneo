import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalBoardsFixture } from "../../api/feedback/list-portal-boards.fixture";
import { useListPortalBoards } from "./use-list-portal-boards";
describe("useListPortalBoards", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalBoards,
    operationId: "listQuillsPortalBoards",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalBoardsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
