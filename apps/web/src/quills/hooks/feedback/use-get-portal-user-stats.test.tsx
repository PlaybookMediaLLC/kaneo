import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPortalUserStatsFixture } from "../../api/feedback/get-portal-user-stats.fixture";
import { useGetPortalUserStats } from "./use-get-portal-user-stats";
describe("useGetPortalUserStats", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPortalUserStats,
    operationId: "getQuillsPortalUserStats",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getPortalUserStatsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
