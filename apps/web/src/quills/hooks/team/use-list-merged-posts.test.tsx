import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listMergedPostsFixture } from "../../api/team/list-merged-posts.fixture";
import { useListMergedPosts } from "./use-list-merged-posts";
describe("useListMergedPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useListMergedPosts,
    operationId: "listQuillsMergedPosts",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", postId: "post-id_test_1" } },
    response: listMergedPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
