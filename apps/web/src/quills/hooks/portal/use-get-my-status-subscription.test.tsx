import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getMyStatusSubscriptionFixture } from "../../api/portal/get-my-status-subscription.fixture";
import { useGetMyStatusSubscription } from "./use-get-my-status-subscription";
describe("useGetMyStatusSubscription", () => {
  describeHookContract({
    kind: "query",
    hook: useGetMyStatusSubscription,
    operationId: "getQuillsMyStatusSubscription",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getMyStatusSubscriptionFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
