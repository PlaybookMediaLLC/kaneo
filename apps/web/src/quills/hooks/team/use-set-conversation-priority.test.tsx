import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setConversationPriorityFixture } from "../../api/team/set-conversation-priority.fixture";
import { useSetConversationPriority } from "./use-set-conversation-priority";
describe("useSetConversationPriority", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetConversationPriority,
    operationId: "setQuillsConversationPriority",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { priority: "none" },
    },
    response: setConversationPriorityFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getConversation",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listConversations",
      ),
    ],
  });
});
