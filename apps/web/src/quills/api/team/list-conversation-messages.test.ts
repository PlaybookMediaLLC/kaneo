import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listConversationMessages } from "./list-conversation-messages";
import { listConversationMessagesFixture } from "./list-conversation-messages.fixture";
describe("listConversationMessages", () => {
  describeOperationContract({
    operationId: "listQuillsConversationMessages",
    operation: listConversationMessages,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: listConversationMessagesFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/messages",
    statuses: [401, 403, 404, 409, 429],
  });
});
