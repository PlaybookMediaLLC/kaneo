import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPublicStatusHistoryFixture } from "../../api/status/list-public-status-history.fixture";
import { useListPublicStatusHistory } from "./use-list-public-status-history";
describe("useListPublicStatusHistory", () => {
  describeHookContract({
    kind: "query",
    hook: useListPublicStatusHistory,
    operationId: "listQuillsPublicStatusHistory",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPublicStatusHistoryFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: "status_cursor_test_2" },
  });
});
