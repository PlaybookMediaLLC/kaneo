import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { addConversationTagFixture } from "../../api/team/add-conversation-tag.fixture";
import { useAddConversationTag } from "./use-add-conversation-tag";
describe("useAddConversationTag", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAddConversationTag,
    operationId: "addQuillsConversationTag",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { tagId: "tag_id_test_1" },
    },
    response: addConversationTagFixture.ok(),
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
