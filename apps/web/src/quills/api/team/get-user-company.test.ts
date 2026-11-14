import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getUserCompany } from "./get-user-company";
import { getUserCompanyFixture } from "./get-user-company.fixture";
describe("getUserCompany", () => {
  describeOperationContract({
    operationId: "getQuillsUserCompany",
    operation: getUserCompany,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: getUserCompanyFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/users/principal-id_test_1/company",
    statuses: [401, 403, 404, 429],
  });
});
