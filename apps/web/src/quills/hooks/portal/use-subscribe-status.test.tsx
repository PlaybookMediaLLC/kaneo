import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { subscribeStatusFixture } from "../../api/portal/subscribe-status.fixture";
import { useSubscribeStatus } from "./use-subscribe-status";
describe("useSubscribeStatus", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSubscribeStatus,
    operationId: "subscribeQuillsStatus",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { scope: "page" },
    },
    response: subscribeStatusFixture.ok(),
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
