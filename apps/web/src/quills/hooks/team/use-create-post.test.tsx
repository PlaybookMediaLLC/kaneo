import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createPostFixture } from "../../api/team/create-post.fixture";
import { useCreatePost } from "./use-create-post";
describe("useCreatePost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreatePost,
    operationId: "createQuillsPost",
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { boardId: "board_id_test_1", title: "value" },
    },
    response: createPostFixture.ok(),
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
