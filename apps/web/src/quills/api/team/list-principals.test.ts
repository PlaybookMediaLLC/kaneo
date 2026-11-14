import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPrincipals } from "./list-principals";
import { listPrincipalsFixture } from "./list-principals.fixture";
describe("listPrincipals", () => {
  describeOperationContract({
    operationId: "listQuillsPrincipals",
    operation: listPrincipals,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listPrincipalsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/principals",
    statuses: [401, 403, 429],
  });
});
