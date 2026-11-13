import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getMyChangelogSubscriptionFixture } from "../../api/portal/get-my-changelog-subscription.fixture";
import { useGetMyChangelogSubscription } from "./use-get-my-changelog-subscription";
describe("useGetMyChangelogSubscription", () => {
  describeHookContract({
    kind: "query",
    hook: useGetMyChangelogSubscription,
    operationId: "getQuillsMyChangelogSubscription",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getMyChangelogSubscriptionFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
