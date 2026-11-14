import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listSegments } from "./list-segments";
import { listSegmentsFixture } from "./list-segments.fixture";
describe("listSegments", () => {
  describeOperationContract({
    operationId: "listQuillsSegments",
    operation: listSegments,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listSegmentsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/segments",
    statuses: [401, 403, 429],
  });
});
