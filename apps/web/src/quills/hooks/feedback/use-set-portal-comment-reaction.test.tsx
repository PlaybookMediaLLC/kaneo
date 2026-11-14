import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPortalCommentReactionFixture } from "../../api/feedback/set-portal-comment-reaction.fixture";
import { useSetPortalCommentReaction } from "./use-set-portal-comment-reaction";
describe("useSetPortalCommentReaction", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPortalCommentReaction,
    operationId: "setQuillsPortalCommentReaction",
    request: {
      param: { workspace: "workspace_test_1", commentId: "comment-id_test_1" },
      json: { emoji: "👍", reacted: false },
    },
    response: setPortalCommentReactionFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "listPortalPostComments",
      ),
    ],
  });
});
