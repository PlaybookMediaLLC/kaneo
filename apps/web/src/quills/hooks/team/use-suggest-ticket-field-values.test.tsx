import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { suggestTicketFieldValuesFixture } from "../../api/team/suggest-ticket-field-values.fixture";
import { useSuggestTicketFieldValues } from "./use-suggest-ticket-field-values";
describe("useSuggestTicketFieldValues", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSuggestTicketFieldValues,
    operationId: "suggestQuillsTicketFieldValues",
    request: {
      param: { workspaceId: "workspace_test_1", ticketId: "ticket-id_test_1" },
    },
    response: suggestTicketFieldValuesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getAssistantRun",
      ),
    ],
  });
});
