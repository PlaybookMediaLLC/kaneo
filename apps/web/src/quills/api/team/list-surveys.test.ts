import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listSurveys } from "./list-surveys";
import { listSurveysFixture } from "./list-surveys.fixture";
describe("listSurveys", () => {
  describeOperationContract({
    operationId: "listQuillsSurveys",
    operation: listSurveys,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listSurveysFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/surveys",
    statuses: [401, 403, 429],
  });
});
