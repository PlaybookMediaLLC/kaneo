import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { submitPortalSurveyResponseFixture } from "../../api/feedback/submit-portal-survey-response.fixture";
import { useSubmitPortalSurveyResponse } from "./use-submit-portal-survey-response";
describe("useSubmitPortalSurveyResponse", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSubmitPortalSurveyResponse,
    operationId: "submitQuillsPortalSurveyResponse",
    request: {
      param: { workspace: "workspace_test_1", surveyId: "survey-id_test_1" },
      json: {},
    },
    response: submitPortalSurveyResponseFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "getPortalActiveSurvey",
      ),
    ],
  });
});
