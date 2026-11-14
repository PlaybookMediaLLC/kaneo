import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createComment } from "./create-comment";
import { createCommentFixture } from "./create-comment.fixture";
describe("createComment", () => {
  describeOperationContract({
    operationId: "createQuillsComment",
    operation: createComment,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { content: "value" },
    },
    response: createCommentFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/comments",
    statuses: [401, 403, 404, 409, 429],
  });
});
