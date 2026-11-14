import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listUsers } from "./list-users";
import { listUsersFixture } from "./list-users.fixture";
describe("listUsers", () => {
  describeOperationContract({
    operationId: "listQuillsUsers",
    operation: listUsers,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listUsersFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/users",
    statuses: [401, 403, 404, 429],
  });
});
