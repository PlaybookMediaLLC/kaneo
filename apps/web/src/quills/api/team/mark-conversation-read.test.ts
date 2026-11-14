import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { markConversationRead } from "./mark-conversation-read";
import { markConversationReadFixture } from "./mark-conversation-read.fixture";
describe("markConversationRead", () => {
  describeOperationContract({
    operationId: "markQuillsConversationRead",
    operation: markConversationRead,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: markConversationReadFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/read",
    statuses: [401, 403, 404, 409, 429],
  });
});
