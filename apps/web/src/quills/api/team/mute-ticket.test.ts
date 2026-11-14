import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { muteTicket } from "./mute-ticket";
import { muteTicketFixture } from "./mute-ticket.fixture";
describe("muteTicket", () => {
  describeOperationContract({
    operationId: "muteQuillsTicket",
    operation: muteTicket,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { days: 1 },
    },
    response: muteTicketFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/mute",
    statuses: [401, 403, 404, 429],
  });
});
