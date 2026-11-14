import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPostFilterCounts } from "./get-post-filter-counts";
import { getPostFilterCountsFixture } from "./get-post-filter-counts.fixture";
describe("getPostFilterCounts", () => {
  describeOperationContract({
    operationId: "getQuillsPostFilterCounts",
    operation: getPostFilterCounts,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: getPostFilterCountsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/counts",
    statuses: [401, 403, 404, 409, 429],
  });
});
