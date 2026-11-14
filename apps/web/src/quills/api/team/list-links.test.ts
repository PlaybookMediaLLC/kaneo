import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listLinks } from "./list-links";
import { listLinksFixture } from "./list-links.fixture";
describe("listLinks", () => {
  describeOperationContract({
    operationId: "listQuillsLinks",
    operation: listLinks,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listLinksFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/links",
    statuses: [401, 403, 404, 429],
  });
});
