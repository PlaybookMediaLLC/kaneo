import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createPostFromConversationFixture } from "../../api/team/create-post-from-conversation.fixture";
import { useCreatePostFromConversation } from "./use-create-post-from-conversation";
describe("useCreatePostFromConversation", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreatePostFromConversation,
    operationId: "createQuillsPostFromConversation",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
      json: {},
    },
    response: createPostFromConversationFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getLinkedPostsForConversation",
      ),
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
