import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { unblockUser } from "./unblock-user";
import { unblockUserFixture } from "./unblock-user.fixture";
describe("unblockUser", () => {
  describeOperationContract({
    operationId: "unblockQuillsUser",
    operation: unblockUser,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: unblockUserFixture.ok(),
    method: "delete",
    path: "/api/quills/workspace_test_1/users/principal-id_test_1/block",
    statuses: [401, 403, 404, 429],
  });
});
