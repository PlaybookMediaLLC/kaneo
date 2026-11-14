import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { addPostProxyVoteFixture } from "../../api/team/add-post-proxy-vote.fixture";
import { useAddPostProxyVote } from "./use-add-post-proxy-vote";
describe("useAddPostProxyVote", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAddPostProxyVote,
    operationId: "addQuillsPostProxyVote",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        postId: "post-id_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: addPostProxyVoteFixture.ok(),
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
