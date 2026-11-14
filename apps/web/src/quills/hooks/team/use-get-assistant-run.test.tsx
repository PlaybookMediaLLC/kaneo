import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getAssistantRunFixture } from "../../api/team/get-assistant-run.fixture";
import { useGetAssistantRun } from "./use-get-assistant-run";
describe("useGetAssistantRun", () => {
  describeHookContract({
    kind: "query",
    hook: useGetAssistantRun,
    operationId: "getQuillsAssistantRun",
    request: {
      param: { workspaceId: "workspace_test_1", runId: "run-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", runId: "run-id_test_1" } },
    response: getAssistantRunFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
