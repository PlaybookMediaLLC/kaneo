import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { muteTicketFixture } from "../../api/team/mute-ticket.fixture";
import { useMuteTicket } from "./use-mute-ticket";
describe("useMuteTicket", () => {
  describeHookContract({
    kind: "mutation",
    hook: useMuteTicket,
    operationId: "muteQuillsTicket",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
      json: { days: 1 },
    },
    response: muteTicketFixture.ok(),
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
