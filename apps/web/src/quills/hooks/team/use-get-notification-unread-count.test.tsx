import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getNotificationUnreadCountFixture } from "../../api/team/get-notification-unread-count.fixture";
import { useGetNotificationUnreadCount } from "./use-get-notification-unread-count";
describe("useGetNotificationUnreadCount", () => {
  describeHookContract({
    kind: "query",
    hook: useGetNotificationUnreadCount,
    operationId: "getQuillsNotificationUnreadCount",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: getNotificationUnreadCountFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
