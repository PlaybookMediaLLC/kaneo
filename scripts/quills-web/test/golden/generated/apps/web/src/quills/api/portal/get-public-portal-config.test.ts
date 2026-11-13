import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicPortalConfig } from "./get-public-portal-config";
import { getPublicPortalConfigFixture } from "./get-public-portal-config.fixture";
describe("getPublicPortalConfig", () => {
  describeOperationContract({
    operationId: "getQuillsPublicPortalConfig",
    operation: getPublicPortalConfig,
    request: { param: { workspace: "workspace_test_1" } },
    response: getPublicPortalConfigFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/config",
    statuses: [404],
  });
});
