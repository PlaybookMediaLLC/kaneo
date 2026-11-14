import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { acceptFeedbackSignalAsVote } from "./accept-feedback-signal-as-vote";
import { acceptFeedbackSignalAsVoteFixture } from "./accept-feedback-signal-as-vote.fixture";
describe("acceptFeedbackSignalAsVote", () => {
  describeOperationContract({
    operationId: "acceptQuillsFeedbackSignalAsVote",
    operation: acceptFeedbackSignalAsVote,
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
      json: { postId: "post_id_test_1" },
    },
    response: acceptFeedbackSignalAsVoteFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/feedback-signals/signal-id_test_1/vote",
    statuses: [401, 403, 404, 409, 429],
  });
});
