import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPortalChangelogEntryFixture } from "../../api/changelog/get-portal-changelog-entry.fixture";
import { useGetPortalChangelogEntry } from "./use-get-portal-changelog-entry";
describe("useGetPortalChangelogEntry", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPortalChangelogEntry,
    operationId: "getQuillsPortalChangelogEntry",
    request: {
      param: { workspace: "workspace_test_1", entryId: "entry-id_test_1" },
    },
    emptyRequest: { param: { workspace: "", entryId: "entry-id_test_1" } },
    response: getPortalChangelogEntryFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
