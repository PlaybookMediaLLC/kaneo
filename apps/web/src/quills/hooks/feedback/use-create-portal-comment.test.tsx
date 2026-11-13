import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createPortalCommentFixture } from "../../api/feedback/create-portal-comment.fixture";
import { useCreatePortalComment } from "./use-create-portal-comment";
describe("useCreatePortalComment", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreatePortalComment,
    operationId: "createQuillsPortalComment",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { content: "value" },
    },
    response: createPortalCommentFixture.ok(),
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
