import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { addConversationNote } from "./add-conversation-note";
import { addConversationNoteFixture } from "./add-conversation-note.fixture";
describe("addConversationNote", () => {
  describeOperationContract({
    operationId: "addQuillsConversationNote",
    operation: addConversationNote,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { content: "value" },
    },
    response: addConversationNoteFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/note",
    statuses: [401, 403, 404, 409, 429],
  });
});
