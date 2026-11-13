import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicStatusPage } from "./get-public-status-page";
import { getPublicStatusPageFixture } from "./get-public-status-page.fixture";
describe("getPublicStatusPage", () => {
  describeOperationContract({
    operationId: "getQuillsPublicStatusPage",
    operation: getPublicStatusPage,
    request: { param: { workspace: "workspace_test_1" } },
    response: getPublicStatusPageFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/status",
    statuses: [403, 404],
  });
});
