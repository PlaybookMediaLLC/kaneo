import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { markTicketRead } from "./mark-ticket-read";
import { markTicketReadFixture } from "./mark-ticket-read.fixture";
describe("markTicketRead", () => {
  describeOperationContract({
    operationId: "markQuillsTicketRead",
    operation: markTicketRead,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: markTicketReadFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/read",
    statuses: [401, 403, 404, 429],
  });
});
