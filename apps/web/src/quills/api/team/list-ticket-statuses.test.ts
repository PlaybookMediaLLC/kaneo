import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTicketStatuses } from "./list-ticket-statuses";
import { listTicketStatusesFixture } from "./list-ticket-statuses.fixture";
describe("listTicketStatuses", () => {
  describeOperationContract({
    operationId: "listQuillsTicketStatuses",
    operation: listTicketStatuses,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listTicketStatusesFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/ticket-statuses",
    statuses: [401, 403, 429],
  });
});
