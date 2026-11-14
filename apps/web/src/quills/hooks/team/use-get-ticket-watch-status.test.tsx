import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getTicketWatchStatusFixture } from "../../api/team/get-ticket-watch-status.fixture";
import { useGetTicketWatchStatus } from "./use-get-ticket-watch-status";
describe("useGetTicketWatchStatus", () => {
  describeHookContract({
    kind: "query",
    hook: useGetTicketWatchStatus,
    operationId: "getQuillsTicketWatchStatus",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: getTicketWatchStatusFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
