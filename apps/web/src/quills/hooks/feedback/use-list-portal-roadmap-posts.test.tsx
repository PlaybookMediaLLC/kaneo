import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalRoadmapPostsFixture } from "../../api/feedback/list-portal-roadmap-posts.fixture";
import { useListPortalRoadmapPosts } from "./use-list-portal-roadmap-posts";
describe("useListPortalRoadmapPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalRoadmapPosts,
    operationId: "listQuillsPortalRoadmapPosts",
    request: {
      param: { workspace: "workspace_test_1", roadmapId: "roadmap-id_test_1" },
    },
    emptyRequest: { param: { workspace: "", roadmapId: "roadmap-id_test_1" } },
    response: listPortalRoadmapPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
