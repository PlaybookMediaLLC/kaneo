import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalVotedPostsFixture } from "../../api/feedback/list-portal-voted-posts.fixture";
import { useListPortalVotedPosts } from "./use-list-portal-voted-posts";
describe("useListPortalVotedPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalVotedPosts,
    operationId: "listQuillsPortalVotedPosts",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalVotedPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
