import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPostStatus } from "./set-post-status";
import { setPostStatusFixture } from "./set-post-status.fixture";
describe("setPostStatus", () => {
  describeOperationContract({
    operationId: "setQuillsPostStatus",
    operation: setPostStatus,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { statusId: "status_id_test_1" },
    },
    response: setPostStatusFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/status",
    statuses: [401, 403, 404, 409, 429],
  });
});
