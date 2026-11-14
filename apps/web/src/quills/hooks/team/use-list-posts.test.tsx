import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPostsFixture } from "../../api/team/list-posts.fixture";
import { useListPosts } from "./use-list-posts";
describe("useListPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useListPosts,
    operationId: "listQuillsPosts",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: "cursor_test_2" },
  });
});
