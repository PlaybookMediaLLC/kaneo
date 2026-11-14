import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getLinkedConversationsForPost } from "./get-linked-conversations-for-post";
import { getLinkedConversationsForPostFixture } from "./get-linked-conversations-for-post.fixture";
describe("getLinkedConversationsForPost", () => {
  describeOperationContract({
    operationId: "getQuillsLinkedConversationsForPost",
    operation: getLinkedConversationsForPost,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    response: getLinkedConversationsForPostFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/conversations",
    statuses: [401, 403, 404, 409, 429],
  });
});
