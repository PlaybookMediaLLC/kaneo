import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { recordPortalAccessDenied } from "./record-portal-access-denied";
import { recordPortalAccessDeniedFixture } from "./record-portal-access-denied.fixture";
describe("recordPortalAccessDenied", () => {
  describeOperationContract({
    operationId: "recordQuillsPortalAccessDenied",
    operation: recordPortalAccessDenied,
    request: { param: { workspace: "workspace_test_1" } },
    response: recordPortalAccessDeniedFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/access-denied",
    statuses: [401, 403, 404, 429],
  });
});
