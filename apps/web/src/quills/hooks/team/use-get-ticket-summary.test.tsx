import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getTicketSummaryFixture } from "../../api/team/get-ticket-summary.fixture";
import { useGetTicketSummary } from "./use-get-ticket-summary";
describe("useGetTicketSummary", () => {
  describeHookContract({
    kind: "query",
    hook: useGetTicketSummary,
    operationId: "getQuillsTicketSummary",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: getTicketSummaryFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
