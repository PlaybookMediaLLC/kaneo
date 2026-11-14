import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listFeedbackSignalsFixture } from "../../api/team/list-feedback-signals.fixture";
import { useListFeedbackSignals } from "./use-list-feedback-signals";
describe("useListFeedbackSignals", () => {
  describeHookContract({
    kind: "query",
    hook: useListFeedbackSignals,
    operationId: "listQuillsFeedbackSignals",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listFeedbackSignalsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
