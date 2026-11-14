import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createTicketFixture } from "../../api/team/create-ticket.fixture";
import { useCreateTicket } from "./use-create-ticket";
describe("useCreateTicket", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreateTicket,
    operationId: "createQuillsTicket",
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { title: "value" },
    },
    response: createTicketFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listTickets",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
    ],
  });
});
