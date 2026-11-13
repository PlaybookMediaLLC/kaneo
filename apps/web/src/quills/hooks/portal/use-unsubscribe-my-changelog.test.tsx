import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { unsubscribeMyChangelogFixture } from "../../api/portal/unsubscribe-my-changelog.fixture";
import { useUnsubscribeMyChangelog } from "./use-unsubscribe-my-changelog";
describe("useUnsubscribeMyChangelog", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUnsubscribeMyChangelog,
    operationId: "unsubscribeQuillsMyChangelog",
    request: { param: { workspace: "workspace_test_1" } },
    response: unsubscribeMyChangelogFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getMyChangelogSubscription",
      ),
    ],
  });
});
