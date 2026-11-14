import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getTicketSummary } from "./get-ticket-summary";
import { getTicketSummaryFixture } from "./get-ticket-summary.fixture";
describe("getTicketSummary", () => {
  describeOperationContract({
    operationId: "getQuillsTicketSummary",
    operation: getTicketSummary,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: getTicketSummaryFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/summary",
    statuses: [401, 403, 404, 429],
  });
});
