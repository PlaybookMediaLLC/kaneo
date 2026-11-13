import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicStatusUptime } from "./get-public-status-uptime";
import { getPublicStatusUptimeFixture } from "./get-public-status-uptime.fixture";
describe("getPublicStatusUptime", () => {
  describeOperationContract({
    operationId: "getQuillsPublicStatusUptime",
    operation: getPublicStatusUptime,
    request: {
      param: { workspace: "workspace_test_1" },
      query: { componentIds: "value" },
    },
    response: getPublicStatusUptimeFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/status/uptime",
    statuses: [403, 404],
  });
});
