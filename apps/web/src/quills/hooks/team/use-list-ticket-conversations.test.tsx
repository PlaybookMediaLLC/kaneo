import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketConversationsFixture } from "../../api/team/list-ticket-conversations.fixture";
import { useListTicketConversations } from "./use-list-ticket-conversations";
describe("useListTicketConversations", () => {
  describeHookContract({
    kind: "query",
    hook: useListTicketConversations,
    operationId: "listQuillsTicketConversations",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: listTicketConversationsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
