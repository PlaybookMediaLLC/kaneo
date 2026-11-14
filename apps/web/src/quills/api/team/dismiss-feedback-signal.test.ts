import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { dismissFeedbackSignal } from "./dismiss-feedback-signal";
import { dismissFeedbackSignalFixture } from "./dismiss-feedback-signal.fixture";
describe("dismissFeedbackSignal", () => {
  describeOperationContract({
    operationId: "dismissQuillsFeedbackSignal",
    operation: dismissFeedbackSignal,
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
    },
    response: dismissFeedbackSignalFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/feedback-signals/signal-id_test_1/dismiss",
    statuses: [401, 403, 404, 409, 429],
  });
});
