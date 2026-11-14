import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { unmuteTicketFixture } from "../../api/team/unmute-ticket.fixture";
import { useUnmuteTicket } from "./use-unmute-ticket";
describe("useUnmuteTicket", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUnmuteTicket,
    operationId: "unmuteQuillsTicket",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: unmuteTicketFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTicketWatchStatus",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listTicketWatchers",
      ),
    ],
  });
});
