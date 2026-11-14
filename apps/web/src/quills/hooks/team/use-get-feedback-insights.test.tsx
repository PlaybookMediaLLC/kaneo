import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getFeedbackInsightsFixture } from "../../api/team/get-feedback-insights.fixture";
import { useGetFeedbackInsights } from "./use-get-feedback-insights";
describe("useGetFeedbackInsights", () => {
  describeHookContract({
    kind: "query",
    hook: useGetFeedbackInsights,
    operationId: "getQuillsFeedbackInsights",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: getFeedbackInsightsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
