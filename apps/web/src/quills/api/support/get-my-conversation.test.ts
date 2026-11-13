import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getMyConversation } from "./get-my-conversation";
import { getMyConversationFixture } from "./get-my-conversation.fixture";
describe("getMyConversation", () => {
  describeOperationContract({
    operationId: "getQuillsMyConversation",
    operation: getMyConversation,
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: getMyConversationFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/support/conversations/conversation-id_test_1",
    statuses: [401, 403, 404],
  });
});
