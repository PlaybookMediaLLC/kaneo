import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPortalChangelogReaction } from "./set-portal-changelog-reaction";
import { setPortalChangelogReactionFixture } from "./set-portal-changelog-reaction.fixture";
describe("setPortalChangelogReaction", () => {
  describeOperationContract({
    operationId: "setQuillsPortalChangelogReaction",
    operation: setPortalChangelogReaction,
    request: {
      param: { workspace: "workspace_test_1", entryId: "entry-id_test_1" },
      json: { emoji: "👍", reacted: false },
    },
    response: setPortalChangelogReactionFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/portal/changelog/entry-id_test_1/reactions",
    statuses: [401, 403, 404, 429],
  });
});
