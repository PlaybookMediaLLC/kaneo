import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPostFilterCountsFixture } from "../../api/team/get-post-filter-counts.fixture";
import { useGetPostFilterCounts } from "./use-get-post-filter-counts";
describe("useGetPostFilterCounts", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPostFilterCounts,
    operationId: "getQuillsPostFilterCounts",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: getPostFilterCountsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
