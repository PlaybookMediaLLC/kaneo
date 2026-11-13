import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getMyChangelogSubscription } from "./get-my-changelog-subscription";
import { getMyChangelogSubscriptionFixture } from "./get-my-changelog-subscription.fixture";
describe("getMyChangelogSubscription", () => {
  describeOperationContract({
    operationId: "getQuillsMyChangelogSubscription",
    operation: getMyChangelogSubscription,
    request: { param: { workspace: "workspace_test_1" } },
    response: getMyChangelogSubscriptionFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/changelog/subscription",
    statuses: [403, 404],
  });
});
