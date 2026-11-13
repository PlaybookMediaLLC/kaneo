import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { markMyConversationRead } from "./mark-my-conversation-read";
import { markMyConversationReadFixture } from "./mark-my-conversation-read.fixture";
describe("markMyConversationRead", () => {
  describeOperationContract({
    operationId: "markQuillsMyConversationRead",
    operation: markMyConversationRead,
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { throughMessageId: "through_message_id_test_1" },
    },
    response: markMyConversationReadFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/support/conversations/conversation-id_test_1/read",
    statuses: [401, 403, 404],
  });
});
