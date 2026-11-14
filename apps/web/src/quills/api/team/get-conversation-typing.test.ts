import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getConversationTyping } from "./get-conversation-typing";
import { getConversationTypingFixture } from "./get-conversation-typing.fixture";
describe("getConversationTyping", () => {
  describeOperationContract({
    operationId: "getQuillsConversationTyping",
    operation: getConversationTyping,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: getConversationTypingFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/typing",
    statuses: [401, 403, 404, 429],
  });
});
