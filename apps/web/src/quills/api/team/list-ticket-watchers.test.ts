import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTicketWatchers } from "./list-ticket-watchers";
import { listTicketWatchersFixture } from "./list-ticket-watchers.fixture";
describe("listTicketWatchers", () => {
  describeOperationContract({
    operationId: "listQuillsTicketWatchers",
    operation: listTicketWatchers,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: listTicketWatchersFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/watchers",
    statuses: [401, 403, 404, 429],
  });
});
