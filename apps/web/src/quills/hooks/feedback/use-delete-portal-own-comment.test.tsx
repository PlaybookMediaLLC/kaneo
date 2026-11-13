import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { deletePortalOwnCommentFixture } from "../../api/feedback/delete-portal-own-comment.fixture";
import { useDeletePortalOwnComment } from "./use-delete-portal-own-comment";
describe("useDeletePortalOwnComment", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDeletePortalOwnComment,
    operationId: "deleteQuillsPortalOwnComment",
    request: {
      param: { workspace: "workspace_test_1", commentId: "comment-id_test_1" },
    },
    response: deletePortalOwnCommentFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "listPortalPostComments",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "listPortalPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "getPortalPost",
      ),
    ],
  });
});
