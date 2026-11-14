import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { removeConversationTagFixture } from "../../api/team/remove-conversation-tag.fixture";
import { useRemoveConversationTag } from "./use-remove-conversation-tag";
describe("useRemoveConversationTag", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRemoveConversationTag,
    operationId: "removeQuillsConversationTag",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
        tagId: "tag-id_test_1",
      },
    },
    response: removeConversationTagFixture.ok(),
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
