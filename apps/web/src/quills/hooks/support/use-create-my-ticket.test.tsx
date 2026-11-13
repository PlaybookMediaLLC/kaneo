import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createMyTicketFixture } from "../../api/support/create-my-ticket.fixture";
import { useCreateMyTicket } from "./use-create-my-ticket";
describe("useCreateMyTicket", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreateMyTicket,
    operationId: "createQuillsMyTicket",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { title: "value" },
    },
    response: createMyTicketFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "support",
        "getMyTickets",
      ),
    ],
  });
});
