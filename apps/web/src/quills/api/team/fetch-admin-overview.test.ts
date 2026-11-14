import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { fetchAdminOverview } from "./fetch-admin-overview";
import { fetchAdminOverviewFixture } from "./fetch-admin-overview.fixture";
describe("fetchAdminOverview", () => {
  describeOperationContract({
    operationId: "fetchQuillsAdminOverview",
    operation: fetchAdminOverview,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: fetchAdminOverviewFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/reporting/admin-overview",
    statuses: [401, 403, 429],
  });
});
