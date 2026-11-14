import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getTicketLinks } from "./get-ticket-links";
import { getTicketLinksFixture } from "./get-ticket-links.fixture";
describe("getTicketLinks", () => {
  describeOperationContract({
    operationId: "getQuillsTicketLinks",
    operation: getTicketLinks,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: getTicketLinksFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/links",
    statuses: [401, 403, 404, 409, 429],
  });
});
