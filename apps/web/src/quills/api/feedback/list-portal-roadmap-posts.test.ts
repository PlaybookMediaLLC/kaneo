import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalRoadmapPosts } from "./list-portal-roadmap-posts";
import { listPortalRoadmapPostsFixture } from "./list-portal-roadmap-posts.fixture";
describe("listPortalRoadmapPosts", () => {
  describeOperationContract({
    operationId: "listQuillsPortalRoadmapPosts",
    operation: listPortalRoadmapPosts,
    request: {
      param: { workspace: "workspace_test_1", roadmapId: "roadmap-id_test_1" },
    },
    response: listPortalRoadmapPostsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/roadmaps/roadmap-id_test_1/posts",
    statuses: [403, 404],
  });
});
