import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createSurveyFixture } from "../../api/team/create-survey.fixture";
import { useCreateSurvey } from "./use-create-survey";
describe("useCreateSurvey", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreateSurvey,
    operationId: "createQuillsSurvey",
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { type: "nps", question: "value" },
    },
    response: createSurveyFixture.ok(),
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
