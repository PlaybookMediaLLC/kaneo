import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPostVoters } from "./list-post-voters";
import { listPostVotersFixture } from "./list-post-voters.fixture";
describe("listPostVoters", () => {
  describeOperationContract({
    operationId: "listQuillsPostVoters",
    operation: listPostVoters,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: listPostVotersFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/voters",
    statuses: [401, 403, 404, 429],
  });
});
