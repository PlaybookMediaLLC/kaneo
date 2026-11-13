import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { deletePortalOwnComment } from "./delete-portal-own-comment";
import { deletePortalOwnCommentFixture } from "./delete-portal-own-comment.fixture";
describe("deletePortalOwnComment", () => {
  describeOperationContract({
    operationId: "deleteQuillsPortalOwnComment",
    operation: deletePortalOwnComment,
    request: {
      param: { workspace: "workspace_test_1", commentId: "comment-id_test_1" },
    },
    response: deletePortalOwnCommentFixture.ok(),
    method: "delete",
    path: "/api/quills-public/workspace_test_1/portal/comments/comment-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
