import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { editPortalOwnCommentFixture } from "../../api/feedback/edit-portal-own-comment.fixture";
import { useEditPortalOwnComment } from "./use-edit-portal-own-comment";
describe("useEditPortalOwnComment", () => {
  describeHookContract({
    kind: "mutation",
    hook: useEditPortalOwnComment,
    operationId: "editQuillsPortalOwnComment",
    request: {
      param: { workspace: "workspace_test_1", commentId: "comment-id_test_1" },
      json: { content: "value" },
    },
    response: editPortalOwnCommentFixture.ok(),
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
