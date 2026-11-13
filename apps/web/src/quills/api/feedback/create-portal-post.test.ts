import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createPortalPost } from "./create-portal-post";
import { createPortalPostFixture } from "./create-portal-post.fixture";
describe("createPortalPost", () => {
  describeOperationContract({
    operationId: "createQuillsPortalPost",
    operation: createPortalPost,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { content: "value" },
    },
    response: createPortalPostFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/posts",
    statuses: [401, 403, 404, 409, 429],
  });
});
