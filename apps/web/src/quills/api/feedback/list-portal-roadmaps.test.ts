import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalRoadmaps } from "./list-portal-roadmaps";
import { listPortalRoadmapsFixture } from "./list-portal-roadmaps.fixture";
describe("listPortalRoadmaps", () => {
  describeOperationContract({
    operationId: "listQuillsPortalRoadmaps",
    operation: listPortalRoadmaps,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalRoadmapsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/roadmaps",
    statuses: [403, 404],
  });
});
