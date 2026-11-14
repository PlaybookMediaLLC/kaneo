import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getSurveyResults } from "./get-survey-results";
import { getSurveyResultsFixture } from "./get-survey-results.fixture";
describe("getSurveyResults", () => {
  describeOperationContract({
    operationId: "getQuillsSurveyResults",
    operation: getSurveyResults,
    request: {
      param: { workspaceId: "workspace_test_1", surveyId: "survey-id_test_1" },
    },
    response: getSurveyResultsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/surveys/survey-id_test_1/results",
    statuses: [401, 403, 404, 429],
  });
});
