import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listMyConversationMessagesFixture } from "../../api/support/list-my-conversation-messages.fixture";
import { useListMyConversationMessages } from "./use-list-my-conversation-messages";
describe("useListMyConversationMessages", () => {
  describeHookContract({
    kind: "query",
    hook: useListMyConversationMessages,
    operationId: "listQuillsMyConversationMessages",
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspace: "", conversationId: "conversation-id_test_1" },
    },
    response: listMyConversationMessagesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    pollMs: 10_000,
  });
});
