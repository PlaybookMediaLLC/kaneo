import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketMessagesFixture } from "../../api/team/list-ticket-messages.fixture";
import { useListTicketMessages } from "./use-list-ticket-messages";
describe("useListTicketMessages", () => {
  describeHookContract({
    kind: "query",
    hook: useListTicketMessages,
    operationId: "listQuillsTicketMessages",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: listTicketMessagesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
