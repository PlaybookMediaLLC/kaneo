import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listStatusesFixture } from "../../api/team/list-statuses.fixture";
import { useListStatuses } from "./use-list-statuses";
describe("useListStatuses", () => {
  describeHookContract({
    kind: "query",
    hook: useListStatuses,
    operationId: "listQuillsStatuses",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listStatusesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
