import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getTeamCounts } from "./get-team-counts";
import { getTeamCountsFixture } from "./get-team-counts.fixture";
describe("getTeamCounts", () => {
  describeOperationContract({
    operationId: "getQuillsTeamCounts",
    operation: getTeamCounts,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: getTeamCountsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/reporting/team-counts",
    statuses: [401, 403, 429],
  });
});
