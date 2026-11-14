import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listSurveysFixture } from "../../api/team/list-surveys.fixture";
import { useListSurveys } from "./use-list-surveys";
describe("useListSurveys", () => {
  describeHookContract({
    kind: "query",
    hook: useListSurveys,
    operationId: "listQuillsSurveys",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listSurveysFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
