import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getRevenueAtRisk } from "./get-revenue-at-risk";
import { getRevenueAtRiskFixture } from "./get-revenue-at-risk.fixture";
describe("getRevenueAtRisk", () => {
  describeOperationContract({
    operationId: "getQuillsRevenueAtRisk",
    operation: getRevenueAtRisk,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: getRevenueAtRiskFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/feedback/revenue-at-risk",
    statuses: [401, 403, 429],
  });
});
