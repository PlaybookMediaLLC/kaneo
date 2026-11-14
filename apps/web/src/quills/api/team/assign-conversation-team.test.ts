import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { assignConversationTeam } from "./assign-conversation-team";
import { assignConversationTeamFixture } from "./assign-conversation-team.fixture";
describe("assignConversationTeam", () => {
  describeOperationContract({
    operationId: "assignQuillsConversationTeam",
    operation: assignConversationTeam,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { teamId: null },
    },
    response: assignConversationTeamFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/team",
    statuses: [401, 403, 404, 409, 429],
  });
});
