import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listMyConversationMessages } from "./list-my-conversation-messages";
import { listMyConversationMessagesFixture } from "./list-my-conversation-messages.fixture";
describe("listMyConversationMessages", () => {
  describeOperationContract({
    operationId: "listQuillsMyConversationMessages",
    operation: listMyConversationMessages,
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: listMyConversationMessagesFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/support/conversations/conversation-id_test_1/messages",
    statuses: [401, 403, 404],
  });
});
