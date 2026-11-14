import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getAssistantRun } from "./get-assistant-run";
import { getAssistantRunFixture } from "./get-assistant-run.fixture";
describe("getAssistantRun", () => {
  describeOperationContract({
    operationId: "getQuillsAssistantRun",
    operation: getAssistantRun,
    request: {
      param: { workspaceId: "workspace_test_1", runId: "run-id_test_1" },
    },
    response: getAssistantRunFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/assistant/runs/run-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
