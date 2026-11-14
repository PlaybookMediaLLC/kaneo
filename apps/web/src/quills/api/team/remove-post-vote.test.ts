import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { removePostVote } from "./remove-post-vote";
import { removePostVoteFixture } from "./remove-post-vote.fixture";
describe("removePostVote", () => {
  describeOperationContract({
    operationId: "removeQuillsPostVote",
    operation: removePostVote,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        postId: "post-id_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: removePostVoteFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/voters/principal-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
