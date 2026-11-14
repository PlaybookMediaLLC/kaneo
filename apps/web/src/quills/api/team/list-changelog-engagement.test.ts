import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listChangelogEngagement } from "./list-changelog-engagement";
import { listChangelogEngagementFixture } from "./list-changelog-engagement.fixture";
describe("listChangelogEngagement", () => {
  describeOperationContract({
    operationId: "listQuillsChangelogEngagement",
    operation: listChangelogEngagement,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listChangelogEngagementFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/changelog-engagement",
    statuses: [401, 403, 429],
  });
});
