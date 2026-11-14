import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTicketMessages } from "./list-ticket-messages";
import { listTicketMessagesFixture } from "./list-ticket-messages.fixture";
describe("listTicketMessages", () => {
  describeOperationContract({
    operationId: "listQuillsTicketMessages",
    operation: listTicketMessages,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: listTicketMessagesFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/messages",
    statuses: [401, 403, 404, 429],
  });
});
