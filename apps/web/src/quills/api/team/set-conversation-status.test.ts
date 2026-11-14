import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setConversationStatus } from "./set-conversation-status";
import { setConversationStatusFixture } from "./set-conversation-status.fixture";
describe("setConversationStatus", () => {
  describeOperationContract({
    operationId: "setQuillsConversationStatus",
    operation: setConversationStatus,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { status: "open" },
    },
    response: setConversationStatusFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/status",
    statuses: [401, 403, 404, 409, 429],
  });
});
