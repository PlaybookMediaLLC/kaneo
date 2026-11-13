import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getMyStatusSubscription } from "./get-my-status-subscription";
import { getMyStatusSubscriptionFixture } from "./get-my-status-subscription.fixture";
describe("getMyStatusSubscription", () => {
  describeOperationContract({
    operationId: "getQuillsMyStatusSubscription",
    operation: getMyStatusSubscription,
    request: { param: { workspace: "workspace_test_1" } },
    response: getMyStatusSubscriptionFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/status/subscription",
    statuses: [401, 403, 404],
  });
});
