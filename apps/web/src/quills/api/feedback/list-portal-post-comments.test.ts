import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalPostComments } from "./list-portal-post-comments";
import { listPortalPostCommentsFixture } from "./list-portal-post-comments.fixture";
describe("listPortalPostComments", () => {
  describeOperationContract({
    operationId: "listQuillsPortalPostComments",
    operation: listPortalPostComments,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: listPortalPostCommentsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1/comments",
    statuses: [403, 404],
  });
});
