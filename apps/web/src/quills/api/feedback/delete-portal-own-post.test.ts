import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { deletePortalOwnPost } from "./delete-portal-own-post";
import { deletePortalOwnPostFixture } from "./delete-portal-own-post.fixture";
describe("deletePortalOwnPost", () => {
  describeOperationContract({
    operationId: "deleteQuillsPortalOwnPost",
    operation: deletePortalOwnPost,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: deletePortalOwnPostFixture.ok(),
    method: "delete",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
