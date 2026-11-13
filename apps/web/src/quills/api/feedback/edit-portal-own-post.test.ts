import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { editPortalOwnPost } from "./edit-portal-own-post";
import { editPortalOwnPostFixture } from "./edit-portal-own-post.fixture";
describe("editPortalOwnPost", () => {
  describeOperationContract({
    operationId: "editQuillsPortalOwnPost",
    operation: editPortalOwnPost,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { title: "value", content: "value" },
    },
    response: editPortalOwnPostFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
