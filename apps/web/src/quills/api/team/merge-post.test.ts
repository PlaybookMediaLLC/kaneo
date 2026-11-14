import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { mergePost } from "./merge-post";
import { mergePostFixture } from "./merge-post.fixture";
describe("mergePost", () => {
  describeOperationContract({
    operationId: "mergeQuillsPost",
    operation: mergePost,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { canonicalPostId: "canonical_post_id_test_1" },
    },
    response: mergePostFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/merge",
    statuses: [401, 403, 404, 409, 429],
  });
});
