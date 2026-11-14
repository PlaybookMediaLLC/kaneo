import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getFeedbackInsights } from "./get-feedback-insights";
import { getFeedbackInsightsFixture } from "./get-feedback-insights.fixture";
describe("getFeedbackInsights", () => {
  describeOperationContract({
    operationId: "getQuillsFeedbackInsights",
    operation: getFeedbackInsights,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: getFeedbackInsightsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/feedback/insights",
    statuses: [400, 401, 403, 404, 429],
  });
});
