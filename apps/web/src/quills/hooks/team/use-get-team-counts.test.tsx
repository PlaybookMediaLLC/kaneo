import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getTeamCountsFixture } from "../../api/team/get-team-counts.fixture";
import { useGetTeamCounts } from "./use-get-team-counts";
describe("useGetTeamCounts", () => {
  describeHookContract({
    kind: "query",
    hook: useGetTeamCounts,
    operationId: "getQuillsTeamCounts",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: getTeamCountsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
