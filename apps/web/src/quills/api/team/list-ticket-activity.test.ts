import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTicketActivity } from "./list-ticket-activity";
import { listTicketActivityFixture } from "./list-ticket-activity.fixture";
describe("listTicketActivity", () => {
  describeOperationContract({
    operationId: "listQuillsTicketActivity",
    operation: listTicketActivity,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: listTicketActivityFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/activity",
    statuses: [401, 403, 404, 429],
  });
});
