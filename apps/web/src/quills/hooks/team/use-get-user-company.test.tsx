import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getUserCompanyFixture } from "../../api/team/get-user-company.fixture";
import { useGetUserCompany } from "./use-get-user-company";
describe("useGetUserCompany", () => {
  describeHookContract({
    kind: "query",
    hook: useGetUserCompany,
    operationId: "getQuillsUserCompany",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", principalId: "principal-id_test_1" },
    },
    response: getUserCompanyFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
