import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPostFixture } from "../../api/team/get-post.fixture";
import { useGetPost } from "./use-get-post";
describe("useGetPost", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPost,
    operationId: "getQuillsPost",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", postId: "post-id_test_1" } },
    response: getPostFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
