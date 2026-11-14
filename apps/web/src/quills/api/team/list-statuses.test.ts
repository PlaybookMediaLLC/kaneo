import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listStatuses } from "./list-statuses";
import { listStatusesFixture } from "./list-statuses.fixture";
describe("listStatuses", () => {
  describeOperationContract({
    operationId: "listQuillsStatuses",
    operation: listStatuses,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listStatusesFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/statuses",
    statuses: [401, 403, 429],
  });
});
