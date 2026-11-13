import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { subscribeMyChangelogFixture } from "../../api/portal/subscribe-my-changelog.fixture";
import { useSubscribeMyChangelog } from "./use-subscribe-my-changelog";
describe("useSubscribeMyChangelog", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSubscribeMyChangelog,
    operationId: "subscribeQuillsMyChangelog",
    request: { param: { workspace: "workspace_test_1" } },
    response: subscribeMyChangelogFixture.ok(),
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
