import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listUsersFixture } from "../../api/team/list-users.fixture";
import { useListUsers } from "./use-list-users";
describe("useListUsers", () => {
  describeHookContract({
    kind: "query",
    hook: useListUsers,
    operationId: "listQuillsUsers",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listUsersFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
