import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPortalVote } from "./set-portal-vote";
import { setPortalVoteFixture } from "./set-portal-vote.fixture";
describe("setPortalVote", () => {
  describeOperationContract({
    operationId: "setQuillsPortalVote",
    operation: setPortalVote,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { voted: false },
    },
    response: setPortalVoteFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1/vote",
    statuses: [401, 403, 404, 429],
  });
});
