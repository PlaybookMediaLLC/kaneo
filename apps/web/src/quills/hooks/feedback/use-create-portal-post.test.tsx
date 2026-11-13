import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createPortalPostFixture } from "../../api/feedback/create-portal-post.fixture";
import { useCreatePortalPost } from "./use-create-portal-post";
describe("useCreatePortalPost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreatePortalPost,
    operationId: "createQuillsPortalPost",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { content: "value" },
    },
    response: createPortalPostFixture.ok(),
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
    ],
  });
});
