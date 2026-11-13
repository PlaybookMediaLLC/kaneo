import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getMyTickets } from "./get-my-tickets";
import { getMyTicketsFixture } from "./get-my-tickets.fixture";
describe("getMyTickets", () => {
  describeOperationContract({
    operationId: "getQuillsMyTickets",
    operation: getMyTickets,
    request: { param: { workspace: "workspace_test_1" } },
    response: getMyTicketsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/support/tickets",
    statuses: [401, 403, 404],
  });
});
