import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { addTicketNote } from "./add-ticket-note";
import { addTicketNoteFixture } from "./add-ticket-note.fixture";
describe("addTicketNote", () => {
  describeOperationContract({
    operationId: "addQuillsTicketNote",
    operation: addTicketNote,
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { content: "value" },
    },
    response: addTicketNoteFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/tickets/ticket-id_test_1/note",
    statuses: [401, 403, 404, 429],
  });
});
