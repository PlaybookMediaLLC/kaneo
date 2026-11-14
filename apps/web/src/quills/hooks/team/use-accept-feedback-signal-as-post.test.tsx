import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { acceptFeedbackSignalAsPostFixture } from "../../api/team/accept-feedback-signal-as-post.fixture";
import { useAcceptFeedbackSignalAsPost } from "./use-accept-feedback-signal-as-post";
describe("useAcceptFeedbackSignalAsPost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAcceptFeedbackSignalAsPost,
    operationId: "acceptQuillsFeedbackSignalAsPost",
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
      json: { boardId: "board_id_test_1", title: "value" },
    },
    response: acceptFeedbackSignalAsPostFixture.ok(),
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
