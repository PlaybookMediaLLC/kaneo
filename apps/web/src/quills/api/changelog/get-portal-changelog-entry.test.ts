import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPortalChangelogEntry } from "./get-portal-changelog-entry";
import { getPortalChangelogEntryFixture } from "./get-portal-changelog-entry.fixture";
describe("getPortalChangelogEntry", () => {
  describeOperationContract({
    operationId: "getQuillsPortalChangelogEntry",
    operation: getPortalChangelogEntry,
    request: {
      param: { workspace: "workspace_test_1", entryId: "entry-id_test_1" },
    },
    response: getPortalChangelogEntryFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/changelog/entry-id_test_1",
    statuses: [403, 404],
  });
});
