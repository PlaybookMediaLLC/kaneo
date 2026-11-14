import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getConversationFixture } from "../../api/team/get-conversation.fixture";
import { useGetConversation } from "./use-get-conversation";
describe("useGetConversation", () => {
  describeHookContract({
    kind: "query",
    hook: useGetConversation,
    operationId: "getQuillsConversation",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", conversationId: "conversation-id_test_1" },
    },
    response: getConversationFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
