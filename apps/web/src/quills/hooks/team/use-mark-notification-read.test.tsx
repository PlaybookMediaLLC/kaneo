import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { markNotificationReadFixture } from "../../api/team/mark-notification-read.fixture";
import { useMarkNotificationRead } from "./use-mark-notification-read";
describe("useMarkNotificationRead", () => {
  describeHookContract({
    kind: "mutation",
    hook: useMarkNotificationRead,
    operationId: "markQuillsNotificationRead",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        notificationId: "notification-id_test_1",
      },
    },
    response: markNotificationReadFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listNotifications",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getNotificationUnreadCount",
      ),
    ],
  });
});
