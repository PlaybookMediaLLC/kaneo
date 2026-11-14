import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setTicketPriority } from "./set-ticket-priority";
import { setTicketPriorityFixture } from "./set-ticket-priority.fixture";
describe("setTicketPriority", () => {
  describeOperationContract({
    operationId: "setQuillsTicketPriority",
    operation: setTicketPriority,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { priority: "none" },
    },
    response: setTicketPriorityFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/priority",
    statuses: [401, 403, 404, 409, 429],
  });
});
