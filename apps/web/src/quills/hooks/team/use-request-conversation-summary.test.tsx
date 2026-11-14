import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { requestConversationSummaryFixture } from "../../api/team/request-conversation-summary.fixture";
import { useRequestConversationSummary } from "./use-request-conversation-summary";
describe("useRequestConversationSummary", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRequestConversationSummary,
    operationId: "requestQuillsConversationSummary",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: requestConversationSummaryFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getConversation",
      ),
    ],
  });
});
