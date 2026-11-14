import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPostStatusFixture } from "../../api/team/set-post-status.fixture";
import { useSetPostStatus } from "./use-set-post-status";
describe("useSetPostStatus", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPostStatus,
    operationId: "setQuillsPostStatus",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { statusId: "status_id_test_1" },
    },
    response: setPostStatusFixture.ok(),
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
        "getPostFilterCounts",
      ),
    ],
  });
});
