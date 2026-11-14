import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPortalUserStats } from "./get-portal-user-stats";
import { getPortalUserStatsFixture } from "./get-portal-user-stats.fixture";
describe("getPortalUserStats", () => {
  describeOperationContract({
    operationId: "getQuillsPortalUserStats",
    operation: getPortalUserStats,
    request: { param: { workspace: "workspace_test_1" } },
    response: getPortalUserStatsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/user/stats",
    statuses: [401, 403, 404],
  });
});
