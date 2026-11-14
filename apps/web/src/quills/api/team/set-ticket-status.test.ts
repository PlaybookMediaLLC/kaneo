import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setTicketStatus } from "./set-ticket-status";
import { setTicketStatusFixture } from "./set-ticket-status.fixture";
describe("setTicketStatus", () => {
  describeOperationContract({
    operationId: "setQuillsTicketStatus",
    operation: setTicketStatus,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { statusId: "status_id_test_1" },
    },
    response: setTicketStatusFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/status",
    statuses: [401, 403, 404, 409, 429],
  });
});
