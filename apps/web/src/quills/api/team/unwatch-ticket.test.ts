import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { unwatchTicket } from "./unwatch-ticket";
import { unwatchTicketFixture } from "./unwatch-ticket.fixture";
describe("unwatchTicket", () => {
  describeOperationContract({
    operationId: "unwatchQuillsTicket",
    operation: unwatchTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: unwatchTicketFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/watch",
    statuses: [401, 403, 404, 429],
  });
});
