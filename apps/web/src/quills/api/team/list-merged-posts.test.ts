import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listMergedPosts } from "./list-merged-posts";
import { listMergedPostsFixture } from "./list-merged-posts.fixture";
describe("listMergedPosts", () => {
  describeOperationContract({
    operationId: "listQuillsMergedPosts",
    operation: listMergedPosts,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: listMergedPostsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/merged",
    statuses: [401, 403, 404, 429],
  });
});
