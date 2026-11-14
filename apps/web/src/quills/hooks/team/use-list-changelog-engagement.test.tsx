import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listChangelogEngagementFixture } from "../../api/team/list-changelog-engagement.fixture";
import { useListChangelogEngagement } from "./use-list-changelog-engagement";
describe("useListChangelogEngagement", () => {
  describeHookContract({
    kind: "query",
    hook: useListChangelogEngagement,
    operationId: "listQuillsChangelogEngagement",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listChangelogEngagementFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
