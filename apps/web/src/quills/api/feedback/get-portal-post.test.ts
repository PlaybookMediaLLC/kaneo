import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPortalPost } from "./get-portal-post";
import { getPortalPostFixture } from "./get-portal-post.fixture";
describe("getPortalPost", () => {
  describeOperationContract({
    operationId: "getQuillsPortalPost",
    operation: getPortalPost,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: getPortalPostFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1",
    statuses: [403, 404],
  });
});
