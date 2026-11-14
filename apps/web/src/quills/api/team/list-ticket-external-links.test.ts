import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTicketExternalLinks } from "./list-ticket-external-links";
import { listTicketExternalLinksFixture } from "./list-ticket-external-links.fixture";
describe("listTicketExternalLinks", () => {
  describeOperationContract({
    operationId: "listQuillsTicketExternalLinks",
    operation: listTicketExternalLinks,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: listTicketExternalLinksFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/external-links",
    statuses: [400, 401, 403, 404, 429],
  });
});
