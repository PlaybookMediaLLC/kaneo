import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { draftChangelogFromPosts } from "./draft-changelog-from-posts";
import { draftChangelogFromPostsFixture } from "./draft-changelog-from-posts.fixture";
describe("draftChangelogFromPosts", () => {
  describeOperationContract({
    operationId: "draftQuillsChangelogFromPosts",
    operation: draftChangelogFromPosts,
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { postIds: [] },
    },
    response: draftChangelogFromPostsFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/changelog/drafts",
    statuses: [401, 403, 404, 409, 429, 502],
  });
});
