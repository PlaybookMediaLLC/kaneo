import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketsFixture } from "../../api/team/list-tickets.fixture";
import { useListTickets } from "./use-list-tickets";
describe("useListTickets", () => {
  describeHookContract({
    kind: "query",
    hook: useListTickets,
    operationId: "listQuillsTickets",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listTicketsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: "cursor_test_2" },
  });
});
