import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { fetchAdminOverviewFixture } from "../../api/team/fetch-admin-overview.fixture";
import { useFetchAdminOverview } from "./use-fetch-admin-overview";
describe("useFetchAdminOverview", () => {
  describeHookContract({
    kind: "query",
    hook: useFetchAdminOverview,
    operationId: "fetchQuillsAdminOverview",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: fetchAdminOverviewFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
