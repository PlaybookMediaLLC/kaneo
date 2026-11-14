import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTicketExternalLinksFixture } from "../../api/team/list-ticket-external-links.fixture";
import { useListTicketExternalLinks } from "./use-list-ticket-external-links";
describe("useListTicketExternalLinks", () => {
  describeHookContract({
    kind: "query",
    hook: useListTicketExternalLinks,
    operationId: "listQuillsTicketExternalLinks",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", ticketId: "ticket-id_test_1" } },
    response: listTicketExternalLinksFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
