import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listConversationMessagesFixture } from "../../api/team/list-conversation-messages.fixture";
import { useListConversationMessages } from "./use-list-conversation-messages";
describe("useListConversationMessages", () => {
  describeHookContract({
    kind: "query",
    hook: useListConversationMessages,
    operationId: "listQuillsConversationMessages",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", conversationId: "conversation-id_test_1" },
    },
    response: listConversationMessagesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
