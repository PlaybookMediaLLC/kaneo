import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listFeedbackSignals } from "./list-feedback-signals";
import { listFeedbackSignalsFixture } from "./list-feedback-signals.fixture";
describe("listFeedbackSignals", () => {
  describeOperationContract({
    operationId: "listQuillsFeedbackSignals",
    operation: listFeedbackSignals,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listFeedbackSignalsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/feedback-signals",
    statuses: [401, 403, 429],
  });
});
