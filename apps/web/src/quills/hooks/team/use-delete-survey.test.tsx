import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { deleteSurveyFixture } from "../../api/team/delete-survey.fixture";
import { useDeleteSurvey } from "./use-delete-survey";
describe("useDeleteSurvey", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDeleteSurvey,
    operationId: "deleteQuillsSurvey",
    request: {
      param: { workspaceId: "workspace_test_1", surveyId: "survey-id_test_1" },
    },
    response: deleteSurveyFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listSurveys",
      ),
    ],
  });
});
