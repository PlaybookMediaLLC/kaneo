import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { unmuteTicket } from "./unmute-ticket";
import { unmuteTicketFixture } from "./unmute-ticket.fixture";
describe("unmuteTicket", () => {
  describeOperationContract({
    operationId: "unmuteQuillsTicket",
    operation: unmuteTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: unmuteTicketFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/mute",
    statuses: [401, 403, 404, 429],
  });
});
