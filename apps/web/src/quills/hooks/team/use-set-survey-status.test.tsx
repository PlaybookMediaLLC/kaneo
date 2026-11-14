import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setSurveyStatusFixture } from "../../api/team/set-survey-status.fixture";
import { useSetSurveyStatus } from "./use-set-survey-status";
describe("useSetSurveyStatus", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetSurveyStatus,
    operationId: "setQuillsSurveyStatus",
    request: {
      param: { workspaceId: "workspace_test_1", surveyId: "survey-id_test_1" },
      json: { status: "active" },
    },
    response: setSurveyStatusFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listSurveys",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getSurveyResults",
      ),
    ],
  });
});
