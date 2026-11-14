import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getRevenueAtRiskFixture } from "../../api/team/get-revenue-at-risk.fixture";
import { useGetRevenueAtRisk } from "./use-get-revenue-at-risk";
describe("useGetRevenueAtRisk", () => {
  describeHookContract({
    kind: "query",
    hook: useGetRevenueAtRisk,
    operationId: "getQuillsRevenueAtRisk",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: getRevenueAtRiskFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
