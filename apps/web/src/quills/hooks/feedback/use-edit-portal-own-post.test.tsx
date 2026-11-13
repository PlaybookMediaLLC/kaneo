import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { editPortalOwnPostFixture } from "../../api/feedback/edit-portal-own-post.fixture";
import { useEditPortalOwnPost } from "./use-edit-portal-own-post";
describe("useEditPortalOwnPost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useEditPortalOwnPost,
    operationId: "editQuillsPortalOwnPost",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { title: "value", content: "value" },
    },
    response: editPortalOwnPostFixture.ok(),
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
        "getPortalPost",
      ),
    ],
  });
});
