import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { sendMyConversationMessage } from "./send-my-conversation-message";
import { sendMyConversationMessageFixture } from "./send-my-conversation-message.fixture";
describe("sendMyConversationMessage", () => {
  describeOperationContract({
    operationId: "sendQuillsMyConversationMessage",
    operation: sendMyConversationMessage,
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { content: "value", idempotencyKey: "value" },
    },
    response: sendMyConversationMessageFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/support/conversations/conversation-id_test_1/messages",
    statuses: [401, 403, 404, 409, 429],
  });
});
