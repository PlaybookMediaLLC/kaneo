import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { addTicketNoteFixture } from "../../api/team/add-ticket-note.fixture";
import { useAddTicketNote } from "./use-add-ticket-note";
describe("useAddTicketNote", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAddTicketNote,
    operationId: "addQuillsTicketNote",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { content: "value" },
    },
    response: addTicketNoteFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listTicketMessages",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listTickets",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTicket",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listTicketActivity",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
    ],
  });
});
