import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createTicket } from "./create-ticket";
import { createTicketFixture } from "./create-ticket.fixture";
describe("createTicket", () => {
  describeOperationContract({
    operationId: "createQuillsTicket",
    operation: createTicket,
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { title: "value" },
    },
    response: createTicketFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets",
    statuses: [401, 403, 404, 409, 429],
  });
});
