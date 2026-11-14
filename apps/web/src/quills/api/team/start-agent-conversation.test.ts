import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { startAgentConversation } from "./start-agent-conversation";
import { startAgentConversationFixture } from "./start-agent-conversation.fixture";
describe("startAgentConversation", () => {
  describeOperationContract({
    operationId: "startQuillsAgentConversation",
    operation: startAgentConversation,
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: {
        targetPrincipalId: "target_principal_id_test_1",
        content: "value",
      },
    },
    response: startAgentConversationFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations",
    statuses: [401, 403, 404, 409, 429],
  });
});
