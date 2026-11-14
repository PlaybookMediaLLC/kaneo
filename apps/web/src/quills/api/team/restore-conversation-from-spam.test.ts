import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { restoreConversationFromSpam } from "./restore-conversation-from-spam";
import { restoreConversationFromSpamFixture } from "./restore-conversation-from-spam.fixture";
describe("restoreConversationFromSpam", () => {
  describeOperationContract({
    operationId: "restoreQuillsConversationFromSpam",
    operation: restoreConversationFromSpam,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: restoreConversationFromSpamFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/restore-spam",
    statuses: [401, 403, 404, 409, 429],
  });
});
