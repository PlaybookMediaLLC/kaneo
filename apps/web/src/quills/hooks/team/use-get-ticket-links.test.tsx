import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getTicketLinksFixture } from "../../api/team/get-ticket-links.fixture";
import { useGetTicketLinks } from "./use-get-ticket-links";
describe("useGetTicketLinks", () => {
  describeHookContract({
    kind: "query",
    hook: useGetTicketLinks,
    operationId: "getQuillsTicketLinks",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: getTicketLinksFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
