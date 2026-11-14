import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getNotificationUnreadCount } from "./get-notification-unread-count";
import { getNotificationUnreadCountFixture } from "./get-notification-unread-count.fixture";
describe("getNotificationUnreadCount", () => {
  describeOperationContract({
    operationId: "getQuillsNotificationUnreadCount",
    operation: getNotificationUnreadCount,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: getNotificationUnreadCountFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/notifications/unread-count",
    statuses: [401, 403, 429],
  });
});
