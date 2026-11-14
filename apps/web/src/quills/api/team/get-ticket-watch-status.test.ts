import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getTicketWatchStatus } from "./get-ticket-watch-status";
import { getTicketWatchStatusFixture } from "./get-ticket-watch-status.fixture";
describe("getTicketWatchStatus", () => {
  describeOperationContract({
    operationId: "getQuillsTicketWatchStatus",
    operation: getTicketWatchStatus,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: getTicketWatchStatusFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/watch",
    statuses: [401, 403, 404, 429],
  });
});
