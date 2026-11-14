import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { submitPortalSurveyResponse } from "./submit-portal-survey-response";
import { submitPortalSurveyResponseFixture } from "./submit-portal-survey-response.fixture";
describe("submitPortalSurveyResponse", () => {
  describeOperationContract({
    operationId: "submitQuillsPortalSurveyResponse",
    operation: submitPortalSurveyResponse,
    request: {
      param: { workspace: "workspace_test_1", surveyId: "survey-id_test_1" },
      json: {},
    },
    response: submitPortalSurveyResponseFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/surveys/survey-id_test_1/responses",
    statuses: [400, 401, 403, 404, 409, 429],
  });
});
