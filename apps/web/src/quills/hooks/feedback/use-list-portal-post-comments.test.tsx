import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalPostCommentsFixture } from "../../api/feedback/list-portal-post-comments.fixture";
import { useListPortalPostComments } from "./use-list-portal-post-comments";
describe("useListPortalPostComments", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalPostComments,
    operationId: "listQuillsPortalPostComments",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspace: "", postId: "post-id_test_1" } },
    response: listPortalPostCommentsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
