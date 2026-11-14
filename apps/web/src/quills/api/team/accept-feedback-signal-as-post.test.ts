import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { acceptFeedbackSignalAsPost } from "./accept-feedback-signal-as-post";
import { acceptFeedbackSignalAsPostFixture } from "./accept-feedback-signal-as-post.fixture";
describe("acceptFeedbackSignalAsPost", () => {
  describeOperationContract({
    operationId: "acceptQuillsFeedbackSignalAsPost",
    operation: acceptFeedbackSignalAsPost,
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
      json: { boardId: "board_id_test_1", title: "value" },
    },
    response: acceptFeedbackSignalAsPostFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/feedback-signals/signal-id_test_1/post",
    statuses: [401, 403, 404, 409, 429],
  });
});
