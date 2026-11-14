import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { markAllNotificationsReadFixture } from "../../api/team/mark-all-notifications-read.fixture";
import { useMarkAllNotificationsRead } from "./use-mark-all-notifications-read";
describe("useMarkAllNotificationsRead", () => {
  describeHookContract({
    kind: "mutation",
    hook: useMarkAllNotificationsRead,
    operationId: "markQuillsAllNotificationsRead",
    request: { param: { workspaceId: "workspace_test_1" } },
    response: markAllNotificationsReadFixture.ok(),
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
