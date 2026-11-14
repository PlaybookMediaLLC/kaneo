import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { deletePostFixture } from "../../api/team/delete-post.fixture";
import { useDeletePost } from "./use-delete-post";
describe("useDeletePost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDeletePost,
    operationId: "deleteQuillsPost",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: deletePostFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPostFilterCounts",
      ),
    ],
  });
});
