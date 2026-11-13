import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { evaluateMyPortalAccess } from "./evaluate-my-portal-access";
import { evaluateMyPortalAccessFixture } from "./evaluate-my-portal-access.fixture";
describe("evaluateMyPortalAccess", () => {
  describeOperationContract({
    operationId: "evaluateQuillsMyPortalAccess",
    operation: evaluateMyPortalAccess,
    request: { param: { workspace: "workspace_test_1" } },
    response: evaluateMyPortalAccessFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/access",
    statuses: [403, 404],
  });
});
