import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { findPortalSimilarPosts } from "./find-portal-similar-posts";
import { findPortalSimilarPostsFixture } from "./find-portal-similar-posts.fixture";
describe("findPortalSimilarPosts", () => {
  describeOperationContract({
    operationId: "findQuillsPortalSimilarPosts",
    operation: findPortalSimilarPosts,
    request: {
      param: { workspace: "workspace_test_1" },
      query: { title: "value" },
    },
    response: findPortalSimilarPostsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/posts/similar",
    statuses: [403, 404, 429],
  });
});
