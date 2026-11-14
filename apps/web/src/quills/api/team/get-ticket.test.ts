import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getTicket } from "./get-ticket";
import { getTicketFixture } from "./get-ticket.fixture";
describe("getTicket", () => {
  describeOperationContract({
    operationId: "getQuillsTicket",
    operation: getTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: getTicketFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
