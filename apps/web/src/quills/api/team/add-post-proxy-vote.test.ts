import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { addPostProxyVote } from "./add-post-proxy-vote";
import { addPostProxyVoteFixture } from "./add-post-proxy-vote.fixture";
describe("addPostProxyVote", () => {
  describeOperationContract({
    operationId: "addQuillsPostProxyVote",
    operation: addPostProxyVote,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        postId: "post-id_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: addPostProxyVoteFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/voters/principal-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
