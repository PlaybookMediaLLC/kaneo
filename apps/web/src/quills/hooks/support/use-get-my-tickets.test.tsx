import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getMyTicketsFixture } from "../../api/support/get-my-tickets.fixture";
import { useGetMyTickets } from "./use-get-my-tickets";
describe("useGetMyTickets", () => {
  describeHookContract({
    kind: "query",
    hook: useGetMyTickets,
    operationId: "getQuillsMyTickets",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getMyTicketsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: "ticket_cursor_test_2" },
  });
});
