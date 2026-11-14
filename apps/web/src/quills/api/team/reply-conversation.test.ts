import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { replyConversation } from "./reply-conversation";
import { replyConversationFixture } from "./reply-conversation.fixture";
describe("replyConversation", () => {
  describeOperationContract({
    operationId: "replyQuillsConversation",
    operation: replyConversation,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { content: "value" },
    },
    response: replyConversationFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/reply",
    statuses: [401, 403, 404, 409, 429],
  });
});
