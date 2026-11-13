import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { subscribeMyChangelog } from "./subscribe-my-changelog";
import { subscribeMyChangelogFixture } from "./subscribe-my-changelog.fixture";
describe("subscribeMyChangelog", () => {
  describeOperationContract({
    operationId: "subscribeQuillsMyChangelog",
    operation: subscribeMyChangelog,
    request: { param: { workspace: "workspace_test_1" } },
    response: subscribeMyChangelogFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/changelog/subscription",
    statuses: [401, 403, 404, 429],
  });
});
