import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { requestTicketSummary } from "./request-ticket-summary";
import { requestTicketSummaryFixture } from "./request-ticket-summary.fixture";
describe("requestTicketSummary", () => {
  describeOperationContract({
    operationId: "requestQuillsTicketSummary",
    operation: requestTicketSummary,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: requestTicketSummaryFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/summary",
    statuses: [401, 403, 404, 409, 429],
  });
});
