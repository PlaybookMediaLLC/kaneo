import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createCommentFixture } from "../../api/team/create-comment.fixture";
import { useCreateComment } from "./use-create-comment";
describe("useCreateComment", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreateComment,
    operationId: "createQuillsComment",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { content: "value" },
    },
    response: createCommentFixture.ok(),
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
        "getPost",
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
        "listPostComments",
      ),
    ],
  });
});
