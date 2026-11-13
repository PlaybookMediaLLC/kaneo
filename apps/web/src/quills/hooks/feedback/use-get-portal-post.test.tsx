import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPortalPostFixture } from "../../api/feedback/get-portal-post.fixture";
import { useGetPortalPost } from "./use-get-portal-post";
describe("useGetPortalPost", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPortalPost,
    operationId: "getQuillsPortalPost",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspace: "", postId: "post-id_test_1" } },
    response: getPortalPostFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
