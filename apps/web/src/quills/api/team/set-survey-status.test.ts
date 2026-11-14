import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setSurveyStatus } from "./set-survey-status";
import { setSurveyStatusFixture } from "./set-survey-status.fixture";
describe("setSurveyStatus", () => {
  describeOperationContract({
    operationId: "setQuillsSurveyStatus",
    operation: setSurveyStatus,
    request: {
      param: { workspaceId: "workspace_test_1", surveyId: "survey-id_test_1" },
      json: { status: "active" },
    },
    response: setSurveyStatusFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/surveys/survey-id_test_1/status",
    statuses: [401, 403, 404, 409, 429],
  });
});
