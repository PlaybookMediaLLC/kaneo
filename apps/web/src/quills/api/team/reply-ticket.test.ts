import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { replyTicket } from "./reply-ticket";
import { replyTicketFixture } from "./reply-ticket.fixture";
describe("replyTicket", () => {
  describeOperationContract({
    operationId: "replyQuillsTicket",
    operation: replyTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { content: "value" },
    },
    response: replyTicketFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/reply",
    statuses: [401, 403, 404, 429],
  });
});
