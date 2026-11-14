import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { deletePost } from "./delete-post";
import { deletePostFixture } from "./delete-post.fixture";
describe("deletePost", () => {
  describeOperationContract({
    operationId: "deleteQuillsPost",
    operation: deletePost,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: deletePostFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
