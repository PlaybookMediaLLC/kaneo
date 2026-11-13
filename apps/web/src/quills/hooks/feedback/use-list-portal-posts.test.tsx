import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalPostsFixture } from "../../api/feedback/list-portal-posts.fixture";
import { useListPortalPosts } from "./use-list-portal-posts";
describe("useListPortalPosts", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalPosts,
    operationId: "listQuillsPortalPosts",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
