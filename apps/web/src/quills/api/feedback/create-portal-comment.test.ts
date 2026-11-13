import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createPortalComment } from "./create-portal-comment";
import { createPortalCommentFixture } from "./create-portal-comment.fixture";
describe("createPortalComment", () => {
  describeOperationContract({
    operationId: "createQuillsPortalComment",
    operation: createPortalComment,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { content: "value" },
    },
    response: createPortalCommentFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1/comments",
    statuses: [401, 403, 404, 409, 429],
  });
});
