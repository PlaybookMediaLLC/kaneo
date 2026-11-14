import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getLinkedConversationsForPostFixture } from "../../api/team/get-linked-conversations-for-post.fixture";
import { useGetLinkedConversationsForPost } from "./use-get-linked-conversations-for-post";
describe("useGetLinkedConversationsForPost", () => {
  describeHookContract({
    kind: "query",
    hook: useGetLinkedConversationsForPost,
    operationId: "getQuillsLinkedConversationsForPost",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", postId: "post-id_test_1" } },
    response: getLinkedConversationsForPostFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
