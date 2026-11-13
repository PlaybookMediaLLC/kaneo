import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { unsubscribeMyChangelog } from "./unsubscribe-my-changelog";
import { unsubscribeMyChangelogFixture } from "./unsubscribe-my-changelog.fixture";
describe("unsubscribeMyChangelog", () => {
  describeOperationContract({
    operationId: "unsubscribeQuillsMyChangelog",
    operation: unsubscribeMyChangelog,
    request: { param: { workspace: "workspace_test_1" } },
    response: unsubscribeMyChangelogFixture.ok(),
    method: "delete",
    path: "/api/quills-public/workspace_test_1/changelog/subscription",
    statuses: [401, 403, 404],
  });
});
