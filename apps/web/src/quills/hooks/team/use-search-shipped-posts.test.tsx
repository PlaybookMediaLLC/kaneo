import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { searchShippedPostsFixture } from "../../api/team/search-shipped-posts.fixture";
import { useSearchShippedPosts } from "./use-search-shipped-posts";
describe("useSearchShippedPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useSearchShippedPosts,
    operationId: "searchQuillsShippedPosts",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: searchShippedPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
