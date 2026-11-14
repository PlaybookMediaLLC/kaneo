import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { assignConversation } from "./assign-conversation";
import { assignConversationFixture } from "./assign-conversation.fixture";
describe("assignConversation", () => {
  describeOperationContract({
    operationId: "assignQuillsConversation",
    operation: assignConversation,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { assigneePrincipalId: "me" },
    },
    response: assignConversationFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/assign",
    statuses: [401, 403, 404, 409, 429],
  });
});
