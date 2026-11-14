import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { markConversationReadFixture } from "../../api/team/mark-conversation-read.fixture";
import { useMarkConversationRead } from "./use-mark-conversation-read";
describe("useMarkConversationRead", () => {
  describeHookContract({
    kind: "mutation",
    hook: useMarkConversationRead,
    operationId: "markQuillsConversationRead",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: markConversationReadFixture.ok(),
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
