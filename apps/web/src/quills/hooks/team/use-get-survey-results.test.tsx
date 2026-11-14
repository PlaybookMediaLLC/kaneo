import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getSurveyResultsFixture } from "../../api/team/get-survey-results.fixture";
import { useGetSurveyResults } from "./use-get-survey-results";
describe("useGetSurveyResults", () => {
  describeHookContract({
    kind: "query",
    hook: useGetSurveyResults,
    operationId: "getQuillsSurveyResults",
    request: {
      param: { workspaceId: "workspace_test_1", surveyId: "survey-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", surveyId: "survey-id_test_1" } },
    response: getSurveyResultsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
