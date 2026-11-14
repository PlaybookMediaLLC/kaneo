import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPortalActiveSurvey } from "./get-portal-active-survey";
import { getPortalActiveSurveyFixture } from "./get-portal-active-survey.fixture";
describe("getPortalActiveSurvey", () => {
  describeOperationContract({
    operationId: "getQuillsPortalActiveSurvey",
    operation: getPortalActiveSurvey,
    request: { param: { workspace: "workspace_test_1" } },
    response: getPortalActiveSurveyFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/surveys/active",
    statuses: [401, 403, 404],
  });
});
