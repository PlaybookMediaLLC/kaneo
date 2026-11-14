import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getUser } from "./get-user";
import { getUserFixture } from "./get-user.fixture";
describe("getUser", () => {
  describeOperationContract({
    operationId: "getQuillsUser",
    operation: getUser,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: getUserFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/users/principal-id_test_1",
    statuses: [401, 403, 404, 429],
  });
});
