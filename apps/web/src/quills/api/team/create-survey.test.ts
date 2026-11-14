import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createSurvey } from "./create-survey";
import { createSurveyFixture } from "./create-survey.fixture";
describe("createSurvey", () => {
  describeOperationContract({
    operationId: "createQuillsSurvey",
    operation: createSurvey,
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { type: "nps", question: "value" },
    },
    response: createSurveyFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/surveys",
    statuses: [400, 401, 403, 404, 429],
  });
});
