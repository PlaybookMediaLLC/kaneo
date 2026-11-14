import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPostDemand } from "./get-post-demand";
import { getPostDemandFixture } from "./get-post-demand.fixture";
describe("getPostDemand", () => {
  describeOperationContract({
    operationId: "getQuillsPostDemand",
    operation: getPostDemand,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: getPostDemandFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/demand",
    statuses: [401, 403, 404, 429],
  });
});
