import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getConversation } from "./get-conversation";
import { getConversationFixture } from "./get-conversation.fixture";
describe("getConversation", () => {
  describeOperationContract({
    operationId: "getQuillsConversation",
    operation: getConversation,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: getConversationFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
