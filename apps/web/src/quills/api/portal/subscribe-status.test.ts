import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { subscribeStatus } from "./subscribe-status";
import { subscribeStatusFixture } from "./subscribe-status.fixture";
describe("subscribeStatus", () => {
  describeOperationContract({
    operationId: "subscribeQuillsStatus",
    operation: subscribeStatus,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { scope: "page" },
    },
    response: subscribeStatusFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/status/subscription",
    statuses: [401, 403, 404, 429],
  });
});
