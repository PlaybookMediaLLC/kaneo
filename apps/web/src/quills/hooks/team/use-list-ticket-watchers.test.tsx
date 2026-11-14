import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketWatchersFixture } from "../../api/team/list-ticket-watchers.fixture";
import { useListTicketWatchers } from "./use-list-ticket-watchers";
describe("useListTicketWatchers", () => {
  describeHookContract({
    kind: "query",
    hook: useListTicketWatchers,
    operationId: "listQuillsTicketWatchers",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: listTicketWatchersFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
