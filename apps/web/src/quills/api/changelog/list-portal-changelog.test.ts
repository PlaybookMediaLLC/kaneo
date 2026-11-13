import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalChangelog } from "./list-portal-changelog";
import { listPortalChangelogFixture } from "./list-portal-changelog.fixture";
describe("listPortalChangelog", () => {
  describeOperationContract({
    operationId: "listQuillsPortalChangelog",
    operation: listPortalChangelog,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalChangelogFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/changelog",
    statuses: [403, 404],
  });
});
