import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { blockUser } from "./block-user";
import { blockUserFixture } from "./block-user.fixture";
describe("blockUser", () => {
  describeOperationContract({
    operationId: "blockQuillsUser",
    operation: blockUser,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: blockUserFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/users/principal-id_test_1/block",
    statuses: [401, 403, 404, 429],
  });
});
