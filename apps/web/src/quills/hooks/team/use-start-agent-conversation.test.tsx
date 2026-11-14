import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { startAgentConversationFixture } from "../../api/team/start-agent-conversation.fixture";
import { useStartAgentConversation } from "./use-start-agent-conversation";
describe("useStartAgentConversation", () => {
  describeHookContract({
    kind: "mutation",
    hook: useStartAgentConversation,
    operationId: "startQuillsAgentConversation",
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: {
        targetPrincipalId: "target_principal_id_test_1",
        content: "value",
      },
    },
    response: startAgentConversationFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listConversations",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
    ],
  });
});
