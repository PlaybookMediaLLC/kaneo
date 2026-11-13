import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicHelpCenter } from "./get-public-help-center";
import { getPublicHelpCenterFixture } from "./get-public-help-center.fixture";
describe("getPublicHelpCenter", () => {
  describeOperationContract({
    operationId: "getQuillsPublicHelpCenter",
    operation: getPublicHelpCenter,
    request: { param: { workspace: "workspace_test_1" } },
    response: getPublicHelpCenterFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/hc",
    statuses: [403, 404],
  });
});
