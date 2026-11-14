import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { unmergePost } from "./unmerge-post";
import { unmergePostFixture } from "./unmerge-post.fixture";
describe("unmergePost", () => {
  describeOperationContract({
    operationId: "unmergeQuillsPost",
    operation: unmergePost,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: unmergePostFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/unmerge",
    statuses: [401, 403, 404, 409, 429],
  });
});
