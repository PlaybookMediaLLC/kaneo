import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPost } from "./get-post";
import { getPostFixture } from "./get-post.fixture";
describe("getPost", () => {
  describeOperationContract({
    operationId: "getQuillsPost",
    operation: getPost,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: getPostFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
