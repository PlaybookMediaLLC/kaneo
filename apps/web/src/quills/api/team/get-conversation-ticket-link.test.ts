import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getConversationTicketLink } from "./get-conversation-ticket-link";
import { getConversationTicketLinkFixture } from "./get-conversation-ticket-link.fixture";
describe("getConversationTicketLink", () => {
  describeOperationContract({
    operationId: "getQuillsConversationTicketLink",
    operation: getConversationTicketLink,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: getConversationTicketLinkFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/ticket",
    statuses: [401, 403, 404, 409, 429],
  });
});
