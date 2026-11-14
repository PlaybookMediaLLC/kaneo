import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPortalChangelogReactionFixture } from "../../api/changelog/set-portal-changelog-reaction.fixture";
import { useSetPortalChangelogReaction } from "./use-set-portal-changelog-reaction";
describe("useSetPortalChangelogReaction", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPortalChangelogReaction,
    operationId: "setQuillsPortalChangelogReaction",
    request: {
      param: { workspace: "workspace_test_1", entryId: "entry-id_test_1" },
      json: { emoji: "👍", reacted: false },
    },
    response: setPortalChangelogReactionFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "changelog",
        "listPortalChangelog",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "changelog",
        "getPortalChangelogEntry",
      ),
    ],
  });
});
