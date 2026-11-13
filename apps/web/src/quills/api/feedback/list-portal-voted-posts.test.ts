import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalVotedPosts } from "./list-portal-voted-posts";
import { listPortalVotedPostsFixture } from "./list-portal-voted-posts.fixture";
describe("listPortalVotedPosts", () => {
  describeOperationContract({
    operationId: "listQuillsPortalVotedPosts",
    operation: listPortalVotedPosts,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalVotedPostsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/voted-posts",
    statuses: [403, 404],
  });
});
