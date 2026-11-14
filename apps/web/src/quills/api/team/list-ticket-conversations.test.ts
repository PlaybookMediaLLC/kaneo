import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTicketConversations } from "./list-ticket-conversations";
import { listTicketConversationsFixture } from "./list-ticket-conversations.fixture";
describe("listTicketConversations", () => {
  describeOperationContract({
    operationId: "listQuillsTicketConversations",
    operation: listTicketConversations,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: listTicketConversationsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/conversations",
    statuses: [401, 403, 404, 409, 429],
  });
});
