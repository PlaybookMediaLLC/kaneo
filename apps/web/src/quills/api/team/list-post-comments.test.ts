import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPostComments } from "./list-post-comments";
import { listPostCommentsFixture } from "./list-post-comments.fixture";
describe("listPostComments", () => {
  describeOperationContract({
    operationId: "listQuillsPostComments",
    operation: listPostComments,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: listPostCommentsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/comments",
    statuses: [401, 403, 404, 409, 429],
  });
});
