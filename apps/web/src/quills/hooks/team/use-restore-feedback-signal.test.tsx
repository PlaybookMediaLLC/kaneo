import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { restoreFeedbackSignalFixture } from "../../api/team/restore-feedback-signal.fixture";
import { useRestoreFeedbackSignal } from "./use-restore-feedback-signal";
describe("useRestoreFeedbackSignal", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRestoreFeedbackSignal,
    operationId: "restoreQuillsFeedbackSignal",
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
    },
    response: restoreFeedbackSignalFixture.ok(),
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
