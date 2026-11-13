import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { deletePortalOwnPostFixture } from "../../api/feedback/delete-portal-own-post.fixture";
import { useDeletePortalOwnPost } from "./use-delete-portal-own-post";
describe("useDeletePortalOwnPost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDeletePortalOwnPost,
    operationId: "deleteQuillsPortalOwnPost",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: deletePortalOwnPostFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
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
        "listPortalBoards",
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
