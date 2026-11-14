import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTickets } from "./list-tickets";
import { listTicketsFixture } from "./list-tickets.fixture";
describe("listTickets", () => {
  describeOperationContract({
    operationId: "listQuillsTickets",
    operation: listTickets,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listTicketsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tickets",
    statuses: [401, 403, 404, 409, 429],
  });
});
