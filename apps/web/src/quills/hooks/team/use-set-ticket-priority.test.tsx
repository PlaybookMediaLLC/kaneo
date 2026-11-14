import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setTicketPriorityFixture } from "../../api/team/set-ticket-priority.fixture";
import { useSetTicketPriority } from "./use-set-ticket-priority";
describe("useSetTicketPriority", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetTicketPriority,
    operationId: "setQuillsTicketPriority",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { priority: "none" },
    },
    response: setTicketPriorityFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
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
