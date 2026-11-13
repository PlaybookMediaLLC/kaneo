import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPortalVoteFixture } from "../../api/feedback/set-portal-vote.fixture";
import { useSetPortalVote } from "./use-set-portal-vote";
describe("useSetPortalVote", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPortalVote,
    operationId: "setQuillsPortalVote",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { voted: false },
    },
    response: setPortalVoteFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "listPortalPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "getPortalPost",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "listPortalRoadmapPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "listPortalVotedPosts",
      ),
    ],
  });
});
