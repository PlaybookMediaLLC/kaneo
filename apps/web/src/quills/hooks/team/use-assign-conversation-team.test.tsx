import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { assignConversationTeamFixture } from "../../api/team/assign-conversation-team.fixture";
import { useAssignConversationTeam } from "./use-assign-conversation-team";
describe("useAssignConversationTeam", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAssignConversationTeam,
    operationId: "assignQuillsConversationTeam",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { teamId: null },
    },
    response: assignConversationTeamFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getConversation",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listConversationMessages",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listConversations",
      ),
    ],
  });
});
