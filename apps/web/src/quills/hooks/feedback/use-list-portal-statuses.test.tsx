import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalStatusesFixture } from "../../api/feedback/list-portal-statuses.fixture";
import { useListPortalStatuses } from "./use-list-portal-statuses";
describe("useListPortalStatuses", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalStatuses,
    operationId: "listQuillsPortalStatuses",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalStatusesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
