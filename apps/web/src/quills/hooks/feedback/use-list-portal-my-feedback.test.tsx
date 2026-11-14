import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalMyFeedbackFixture } from "../../api/feedback/list-portal-my-feedback.fixture";
import { useListPortalMyFeedback } from "./use-list-portal-my-feedback";
describe("useListPortalMyFeedback", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalMyFeedback,
    operationId: "listQuillsPortalMyFeedback",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalMyFeedbackFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
