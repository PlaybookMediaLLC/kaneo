import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTeams } from "./list-teams";
import { listTeamsFixture } from "./list-teams.fixture";
describe("listTeams", () => {
  describeOperationContract({
    operationId: "listQuillsTeams",
    operation: listTeams,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listTeamsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/teams",
    statuses: [401, 403, 404, 429],
  });
});
