import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { restoreConversationFromSpamFixture } from "../../api/team/restore-conversation-from-spam.fixture";
import { useRestoreConversationFromSpam } from "./use-restore-conversation-from-spam";
describe("useRestoreConversationFromSpam", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRestoreConversationFromSpam,
    operationId: "restoreQuillsConversationFromSpam",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: restoreConversationFromSpamFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listConversations",
      ),
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
        "listConversationMessages",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
    ],
  });
});
