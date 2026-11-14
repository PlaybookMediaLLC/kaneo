import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { watchTicket } from "./watch-ticket";
import { watchTicketFixture } from "./watch-ticket.fixture";
describe("watchTicket", () => {
  describeOperationContract({
    operationId: "watchQuillsTicket",
    operation: watchTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: watchTicketFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/watch",
    statuses: [401, 403, 404, 429],
  });
});
