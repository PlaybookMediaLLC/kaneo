import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { dismissFeedbackSignalFixture } from "../../api/team/dismiss-feedback-signal.fixture";
import { useDismissFeedbackSignal } from "./use-dismiss-feedback-signal";
describe("useDismissFeedbackSignal", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDismissFeedbackSignal,
    operationId: "dismissQuillsFeedbackSignal",
    request: {
      param: { workspaceId: "workspace_test_1", signalId: "signal-id_test_1" },
    },
    response: dismissFeedbackSignalFixture.ok(),
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
