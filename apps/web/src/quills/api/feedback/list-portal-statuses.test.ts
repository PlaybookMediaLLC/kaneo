import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalStatuses } from "./list-portal-statuses";
import { listPortalStatusesFixture } from "./list-portal-statuses.fixture";
describe("listPortalStatuses", () => {
  describeOperationContract({
    operationId: "listQuillsPortalStatuses",
    operation: listPortalStatuses,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalStatusesFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/statuses",
    statuses: [403, 404],
  });
});
