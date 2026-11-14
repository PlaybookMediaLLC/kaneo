import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createPostFromConversation } from "./create-post-from-conversation";
import { createPostFromConversationFixture } from "./create-post-from-conversation.fixture";
describe("createPostFromConversation", () => {
  describeOperationContract({
    operationId: "createQuillsPostFromConversation",
    operation: createPostFromConversation,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: {},
    },
    response: createPostFromConversationFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversations/conversation-id_test_1/posts",
    statuses: [401, 403, 404, 409, 429],
  });
});
