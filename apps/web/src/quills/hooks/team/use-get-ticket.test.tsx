import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getTicketFixture } from "../../api/team/get-ticket.fixture";
import { useGetTicket } from "./use-get-ticket";
describe("useGetTicket", () => {
  describeHookContract({
    kind: "query",
    hook: useGetTicket,
    operationId: "getQuillsTicket",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: getTicketFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
