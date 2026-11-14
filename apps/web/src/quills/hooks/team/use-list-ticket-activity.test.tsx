import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketActivityFixture } from "../../api/team/list-ticket-activity.fixture";
import { useListTicketActivity } from "./use-list-ticket-activity";
describe("useListTicketActivity", () => {
  describeHookContract({
    kind: "query",
    hook: useListTicketActivity,
    operationId: "listQuillsTicketActivity",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: listTicketActivityFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
