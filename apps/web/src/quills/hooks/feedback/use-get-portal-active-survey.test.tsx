import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPortalActiveSurveyFixture } from "../../api/feedback/get-portal-active-survey.fixture";
import { useGetPortalActiveSurvey } from "./use-get-portal-active-survey";
describe("useGetPortalActiveSurvey", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPortalActiveSurvey,
    operationId: "getQuillsPortalActiveSurvey",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getPortalActiveSurveyFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
