import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { startMyConversationFixture } from "../../api/support/start-my-conversation.fixture";
import { useStartMyConversation } from "./use-start-my-conversation";
describe("useStartMyConversation", () => {
  describeHookContract({
    kind: "mutation",
    hook: useStartMyConversation,
    operationId: "startQuillsMyConversation",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { content: "value", idempotencyKey: "value" },
    },
    response: startMyConversationFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "support",
        "listMyConversations",
      ),
    ],
  });
});
