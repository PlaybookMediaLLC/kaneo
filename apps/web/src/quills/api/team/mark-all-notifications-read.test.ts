import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { markAllNotificationsRead } from "./mark-all-notifications-read";
import { markAllNotificationsReadFixture } from "./mark-all-notifications-read.fixture";
describe("markAllNotificationsRead", () => {
  describeOperationContract({
    operationId: "markQuillsAllNotificationsRead",
    operation: markAllNotificationsRead,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: markAllNotificationsReadFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/notifications/read-all",
    statuses: [401, 403, 429],
  });
});
