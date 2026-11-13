import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalPosts } from "./list-portal-posts";
import { listPortalPostsFixture } from "./list-portal-posts.fixture";
describe("listPortalPosts", () => {
  describeOperationContract({
    operationId: "listQuillsPortalPosts",
    operation: listPortalPosts,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalPostsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/posts",
    statuses: [403, 404],
  });
});
