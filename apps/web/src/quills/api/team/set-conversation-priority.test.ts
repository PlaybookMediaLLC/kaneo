import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setConversationPriority } from "./set-conversation-priority";
import { setConversationPriorityFixture } from "./set-conversation-priority.fixture";
describe("setConversationPriority", () => {
  describeOperationContract({
    operationId: "setQuillsConversationPriority",
    operation: setConversationPriority,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { priority: "none" },
    },
    response: setConversationPriorityFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/priority",
    statuses: [401, 403, 404, 409, 429],
  });
});
