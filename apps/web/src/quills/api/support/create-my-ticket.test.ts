import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createMyTicket } from "./create-my-ticket";
import { createMyTicketFixture } from "./create-my-ticket.fixture";
describe("createMyTicket", () => {
  describeOperationContract({
    operationId: "createQuillsMyTicket",
    operation: createMyTicket,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { title: "value" },
    },
    response: createMyTicketFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/support/tickets",
    statuses: [401, 403, 404, 409, 429],
  });
});
