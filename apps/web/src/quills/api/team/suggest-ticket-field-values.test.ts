import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { suggestTicketFieldValues } from "./suggest-ticket-field-values";
import { suggestTicketFieldValuesFixture } from "./suggest-ticket-field-values.fixture";
describe("suggestTicketFieldValues", () => {
  describeOperationContract({
    operationId: "suggestQuillsTicketFieldValues",
    operation: suggestTicketFieldValues,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: suggestTicketFieldValuesFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/field-suggestions",
    statuses: [401, 403, 404, 409, 429],
  });
});
