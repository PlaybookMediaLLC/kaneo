import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listNotifications } from "./list-notifications";
import { listNotificationsFixture } from "./list-notifications.fixture";
describe("listNotifications", () => {
  describeOperationContract({
    operationId: "listQuillsNotifications",
    operation: listNotifications,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listNotificationsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/notifications",
    statuses: [401, 403, 429],
  });
});
