import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { searchShippedPosts } from "./search-shipped-posts";
import { searchShippedPostsFixture } from "./search-shipped-posts.fixture";
describe("searchShippedPosts", () => {
  describeOperationContract({
    operationId: "searchQuillsShippedPosts",
    operation: searchShippedPosts,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: searchShippedPostsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/changelog/shipped-posts",
    statuses: [401, 403, 404, 429],
  });
});
