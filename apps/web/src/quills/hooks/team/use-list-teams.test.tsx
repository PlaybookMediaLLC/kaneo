import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTeamsFixture } from "../../api/team/list-teams.fixture";
import { useListTeams } from "./use-list-teams";
describe("useListTeams", () => {
  describeHookContract({
    kind: "query",
    hook: useListTeams,
    operationId: "listQuillsTeams",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listTeamsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
