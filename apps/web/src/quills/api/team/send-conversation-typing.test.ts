import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { sendConversationTyping } from "./send-conversation-typing";
import { sendConversationTypingFixture } from "./send-conversation-typing.fixture";
describe("sendConversationTyping", () => {
  describeOperationContract({
    operationId: "sendQuillsConversationTyping",
    operation: sendConversationTyping,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: sendConversationTypingFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/typing",
    statuses: [401, 403, 404, 429],
  });
});
