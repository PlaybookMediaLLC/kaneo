import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { draftChangelogFromPostsFixture } from "../../api/team/draft-changelog-from-posts.fixture";
import { useDraftChangelogFromPosts } from "./use-draft-changelog-from-posts";
describe("useDraftChangelogFromPosts", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDraftChangelogFromPosts,
    operationId: "draftQuillsChangelogFromPosts",
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { postIds: [] },
    },
    response: draftChangelogFromPostsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listChangelogEngagement",
      ),
    ],
  });
});
