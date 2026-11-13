import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPortalCommentReaction } from "./set-portal-comment-reaction";
import { setPortalCommentReactionFixture } from "./set-portal-comment-reaction.fixture";
describe("setPortalCommentReaction", () => {
  describeOperationContract({
    operationId: "setQuillsPortalCommentReaction",
    operation: setPortalCommentReaction,
    request: {
      param: { workspace: "workspace_test_1", commentId: "comment-id_test_1" },
      json: { emoji: "👍", reacted: false },
    },
    response: setPortalCommentReactionFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/portal/comments/comment-id_test_1/reactions",
    statuses: [401, 403, 404, 429],
  });
});
