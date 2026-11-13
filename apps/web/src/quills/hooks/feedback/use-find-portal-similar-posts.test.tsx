import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { findPortalSimilarPostsFixture } from "../../api/feedback/find-portal-similar-posts.fixture";
import { useFindPortalSimilarPosts } from "./use-find-portal-similar-posts";
describe("useFindPortalSimilarPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useFindPortalSimilarPosts,
    operationId: "findQuillsPortalSimilarPosts",
    request: {
      param: { workspace: "workspace_test_1" },
      query: { title: "value" },
    },
    emptyRequest: { param: { workspace: "" }, query: { title: "value" } },
    response: findPortalSimilarPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
