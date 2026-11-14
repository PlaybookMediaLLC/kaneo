import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { requestTicketSummaryFixture } from "../../api/team/request-ticket-summary.fixture";
import { useRequestTicketSummary } from "./use-request-ticket-summary";
describe("useRequestTicketSummary", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRequestTicketSummary,
    operationId: "requestQuillsTicketSummary",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: requestTicketSummaryFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTicketSummary",
      ),
    ],
  });
});
