import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getConversationTypingFixture } from "../../api/team/get-conversation-typing.fixture";
import { useGetConversationTyping } from "./use-get-conversation-typing";
describe("useGetConversationTyping", () => {
  describeHookContract({
    kind: "query",
    hook: useGetConversationTyping,
    operationId: "getQuillsConversationTyping",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", conversationId: "conversation-id_test_1" },
    },
    response: getConversationTypingFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],

    pollMs: 10000,
  });
});
