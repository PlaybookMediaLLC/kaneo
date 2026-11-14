import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getLinkedPostsForConversationFixture } from "../../api/team/get-linked-posts-for-conversation.fixture";
import { useGetLinkedPostsForConversation } from "./use-get-linked-posts-for-conversation";
describe("useGetLinkedPostsForConversation", () => {
  describeHookContract({
    kind: "query",
    hook: useGetLinkedPostsForConversation,
    operationId: "getQuillsLinkedPostsForConversation",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", conversationId: "conversation-id_test_1" },
    },
    response: getLinkedPostsForConversationFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
