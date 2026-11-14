import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listBoardsFixture } from "../../api/team/list-boards.fixture";
import { useListBoards } from "./use-list-boards";
describe("useListBoards", () => {
  describeHookContract({
    kind: "query",
    hook: useListBoards,
    operationId: "listQuillsBoards",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listBoardsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
