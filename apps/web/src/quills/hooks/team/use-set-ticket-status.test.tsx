import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setTicketStatusFixture } from "../../api/team/set-ticket-status.fixture";
import { useSetTicketStatus } from "./use-set-ticket-status";
describe("useSetTicketStatus", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetTicketStatus,
    operationId: "setQuillsTicketStatus",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { statusId: "status_id_test_1" },
    },
    response: setTicketStatusFixture.ok(),
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
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listTicketMessages",
      ),
    ],
  });
});
