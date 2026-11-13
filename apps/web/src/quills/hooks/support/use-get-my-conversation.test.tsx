import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getMyConversationFixture } from "../../api/support/get-my-conversation.fixture";
import { useGetMyConversation } from "./use-get-my-conversation";
describe("useGetMyConversation", () => {
  describeHookContract({
    kind: "query",
    hook: useGetMyConversation,
    operationId: "getQuillsMyConversation",
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspace: "", conversationId: "conversation-id_test_1" },
    },
    response: getMyConversationFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    pollMs: 10_000,
  });
});
