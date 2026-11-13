import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { sendMyConversationMessageFixture } from "../../api/support/send-my-conversation-message.fixture";
import { useSendMyConversationMessage } from "./use-send-my-conversation-message";
describe("useSendMyConversationMessage", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSendMyConversationMessage,
    operationId: "sendQuillsMyConversationMessage",
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { content: "value", idempotencyKey: "value" },
    },
    response: sendMyConversationMessageFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "support",
        "getMyConversation",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "support",
        "listMyConversationMessages",
      ),
    ],
  });
});
