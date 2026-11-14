import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { deleteSurvey } from "./delete-survey";
import { deleteSurveyFixture } from "./delete-survey.fixture";
describe("deleteSurvey", () => {
  describeOperationContract({
    operationId: "deleteQuillsSurvey",
    operation: deleteSurvey,
    request: {
      param: { workspaceId: "workspace_test_1", surveyId: "survey-id_test_1" },
    },
    response: deleteSurveyFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/surveys/survey-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
