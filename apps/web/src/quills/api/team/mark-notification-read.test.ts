import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { markNotificationRead } from "./mark-notification-read";
import { markNotificationReadFixture } from "./mark-notification-read.fixture";
describe("markNotificationRead", () => {
  describeOperationContract({
    operationId: "markQuillsNotificationRead",
    operation: markNotificationRead,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        notificationId: "notification-id_test_1",
      },
    },
    response: markNotificationReadFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/notifications/notification-id_test_1/read",
    statuses: [401, 403, 404, 429],
  });
});
