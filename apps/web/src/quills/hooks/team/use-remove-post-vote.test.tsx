import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { removePostVoteFixture } from "../../api/team/remove-post-vote.fixture";
import { useRemovePostVote } from "./use-remove-post-vote";
describe("useRemovePostVote", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRemovePostVote,
    operationId: "removeQuillsPostVote",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        postId: "post-id_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: removePostVoteFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPost",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPostVoters",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPostDemand",
      ),
    ],
  });
});
