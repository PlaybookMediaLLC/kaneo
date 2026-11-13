import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { unsubscribeStatus } from "./unsubscribe-status";
import { unsubscribeStatusFixture } from "./unsubscribe-status.fixture";
describe("unsubscribeStatus", () => {
  describeOperationContract({
    operationId: "unsubscribeQuillsStatus",
    operation: unsubscribeStatus,
    request: { param: { workspace: "workspace_test_1" } },
    response: unsubscribeStatusFixture.ok(),
    method: "delete",
    path: "/api/quills-public/workspace_test_1/status/subscription",
    statuses: [401, 403, 404],
  });
});
