import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { markMyConversationReadFixture } from "../../api/support/mark-my-conversation-read.fixture";
import { useMarkMyConversationRead } from "./use-mark-my-conversation-read";
describe("useMarkMyConversationRead", () => {
  describeHookContract({
    kind: "mutation",
    hook: useMarkMyConversationRead,
    operationId: "markQuillsMyConversationRead",
    request: {
      param: {
        workspace: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { throughMessageId: "through_message_id_test_1" },
    },
    response: markMyConversationReadFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "support",
        "getMyConversation",
      ),
    ],
  });
});
