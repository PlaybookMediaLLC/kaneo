import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPostCommentsFixture } from "../../api/team/list-post-comments.fixture";
import { useListPostComments } from "./use-list-post-comments";
describe("useListPostComments", () => {
  describeHookContract({
    kind: "query",
    hook: useListPostComments,
    operationId: "listQuillsPostComments",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", postId: "post-id_test_1" } },
    response: listPostCommentsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
