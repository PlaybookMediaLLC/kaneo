import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { editPortalOwnComment } from "./edit-portal-own-comment";
import { editPortalOwnCommentFixture } from "./edit-portal-own-comment.fixture";
describe("editPortalOwnComment", () => {
  describeOperationContract({
    operationId: "editQuillsPortalOwnComment",
    operation: editPortalOwnComment,
    request: {
      param: { workspace: "workspace_test_1", commentId: "comment-id_test_1" },
      json: { content: "value" },
    },
    response: editPortalOwnCommentFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/portal/comments/comment-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
