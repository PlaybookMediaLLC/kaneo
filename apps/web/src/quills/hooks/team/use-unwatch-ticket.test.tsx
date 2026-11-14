import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { unwatchTicketFixture } from "../../api/team/unwatch-ticket.fixture";
import { useUnwatchTicket } from "./use-unwatch-ticket";
describe("useUnwatchTicket", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUnwatchTicket,
    operationId: "unwatchQuillsTicket",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: unwatchTicketFixture.ok(),
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
