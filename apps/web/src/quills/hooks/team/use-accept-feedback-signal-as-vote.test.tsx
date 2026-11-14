import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { acceptFeedbackSignalAsVoteFixture } from "../../api/team/accept-feedback-signal-as-vote.fixture";
import { useAcceptFeedbackSignalAsVote } from "./use-accept-feedback-signal-as-vote";
describe("useAcceptFeedbackSignalAsVote", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAcceptFeedbackSignalAsVote,
    operationId: "acceptQuillsFeedbackSignalAsVote",
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
      json: { postId: "post_id_test_1" },
    },
    response: acceptFeedbackSignalAsVoteFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listFeedbackSignals",
      ),
    ],
  });
});
