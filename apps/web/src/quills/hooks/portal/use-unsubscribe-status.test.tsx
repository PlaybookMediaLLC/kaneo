import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { unsubscribeStatusFixture } from "../../api/portal/unsubscribe-status.fixture";
import { useUnsubscribeStatus } from "./use-unsubscribe-status";
describe("useUnsubscribeStatus", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUnsubscribeStatus,
    operationId: "unsubscribeQuillsStatus",
    request: { param: { workspace: "workspace_test_1" } },
    response: unsubscribeStatusFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getMyStatusSubscription",
      ),
    ],
  });
});
