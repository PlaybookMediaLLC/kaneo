import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getLinkedPostsForConversation } from "./get-linked-posts-for-conversation";
import { getLinkedPostsForConversationFixture } from "./get-linked-posts-for-conversation.fixture";
describe("getLinkedPostsForConversation", () => {
  describeOperationContract({
    operationId: "getQuillsLinkedPostsForConversation",
    operation: getLinkedPostsForConversation,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    response: getLinkedPostsForConversationFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/posts",
    statuses: [401, 403, 404, 409, 429],
  });
});
