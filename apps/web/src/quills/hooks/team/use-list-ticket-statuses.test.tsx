import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketStatusesFixture } from "../../api/team/list-ticket-statuses.fixture";
import { useListTicketStatuses } from "./use-list-ticket-statuses";
describe("useListTicketStatuses", () => {
  describeHookContract({
    kind: "query",
    hook: useListTicketStatuses,
    operationId: "listQuillsTicketStatuses",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listTicketStatusesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
