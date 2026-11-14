import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { addConversationNoteFixture } from "../../api/team/add-conversation-note.fixture";
import { useAddConversationNote } from "./use-add-conversation-note";
describe("useAddConversationNote", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAddConversationNote,
    operationId: "addQuillsConversationNote",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { content: "value" },
    },
    response: addConversationNoteFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
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
        "getConversation",
      ),
    ],
  });
});
