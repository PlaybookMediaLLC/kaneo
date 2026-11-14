import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { requestConversationSummary } from "./request-conversation-summary";
import { requestConversationSummaryFixture } from "./request-conversation-summary.fixture";
describe("requestConversationSummary", () => {
  describeOperationContract({
    operationId: "requestQuillsConversationSummary",
    operation: requestConversationSummary,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: requestConversationSummaryFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/summary",
    statuses: [401, 403, 404, 409, 429],
  });
});
