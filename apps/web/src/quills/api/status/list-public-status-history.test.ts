import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPublicStatusHistory } from "./list-public-status-history";
import { listPublicStatusHistoryFixture } from "./list-public-status-history.fixture";
describe("listPublicStatusHistory", () => {
  describeOperationContract({
    operationId: "listQuillsPublicStatusHistory",
    operation: listPublicStatusHistory,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPublicStatusHistoryFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/status/history",
    statuses: [403, 404],
  });
});
