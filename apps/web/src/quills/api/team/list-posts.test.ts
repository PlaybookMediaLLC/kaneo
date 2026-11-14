import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPosts } from "./list-posts";
import { listPostsFixture } from "./list-posts.fixture";
describe("listPosts", () => {
  describeOperationContract({
    operationId: "listQuillsPosts",
    operation: listPosts,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listPostsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts",
    statuses: [401, 403, 404, 409, 429],
  });
});
