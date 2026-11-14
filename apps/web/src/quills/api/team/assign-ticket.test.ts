import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { assignTicket } from "./assign-ticket";
import { assignTicketFixture } from "./assign-ticket.fixture";
describe("assignTicket", () => {
  describeOperationContract({
    operationId: "assignQuillsTicket",
    operation: assignTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: {},
    },
    response: assignTicketFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/assign",
    statuses: [401, 403, 404, 409, 429],
  });
});
