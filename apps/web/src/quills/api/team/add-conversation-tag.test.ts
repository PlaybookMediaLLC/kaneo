import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { addConversationTag } from "./add-conversation-tag";
import { addConversationTagFixture } from "./add-conversation-tag.fixture";
describe("addConversationTag", () => {
  describeOperationContract({
    operationId: "addQuillsConversationTag",
    operation: addConversationTag,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: { tagId: "tag_id_test_1" },
    },
    response: addConversationTagFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/tags",
    statuses: [401, 403, 404, 409, 429],
  });
});
