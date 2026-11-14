import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listNotificationsFixture } from "../../api/team/list-notifications.fixture";
import { useListNotifications } from "./use-list-notifications";
describe("useListNotifications", () => {
  describeHookContract({
    kind: "query",
    hook: useListNotifications,
    operationId: "listQuillsNotifications",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listNotificationsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
