import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalChangelogFixture } from "../../api/changelog/list-portal-changelog.fixture";
import { useListPortalChangelog } from "./use-list-portal-changelog";
describe("useListPortalChangelog", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalChangelog,
    operationId: "listQuillsPortalChangelog",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalChangelogFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
