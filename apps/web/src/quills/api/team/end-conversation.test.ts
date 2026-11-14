import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { endConversation } from "./end-conversation";
import { endConversationFixture } from "./end-conversation.fixture";
describe("endConversation", () => {
  describeOperationContract({
    operationId: "endQuillsConversation",
    operation: endConversation,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { reason: "resolved" },
    },
    response: endConversationFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/end",
    statuses: [401, 403, 404, 409, 429],
  });
});
