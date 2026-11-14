import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { sendConversationTypingFixture } from "../../api/team/send-conversation-typing.fixture";
import { useSendConversationTyping } from "./use-send-conversation-typing";
describe("useSendConversationTyping", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSendConversationTyping,
    operationId: "sendQuillsConversationTyping",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: sendConversationTypingFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getConversationTyping",
      ),
    ],
  });
});
