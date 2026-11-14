import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { removeConversationTag } from "./remove-conversation-tag";
import { removeConversationTagFixture } from "./remove-conversation-tag.fixture";
describe("removeConversationTag", () => {
  describeOperationContract({
    operationId: "removeQuillsConversationTag",
    operation: removeConversationTag,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
        tagId: "tag-id_test_1",
      },
    },
    response: removeConversationTagFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/tags/tag-id_test_1",
    statuses: [401, 403, 404, 409, 429],
  });
});
