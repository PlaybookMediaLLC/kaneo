import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPortalFollowFixture } from "../../api/feedback/set-portal-follow.fixture";
import { useSetPortalFollow } from "./use-set-portal-follow";
describe("useSetPortalFollow", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPortalFollow,
    operationId: "setQuillsPortalFollow",
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { following: false },
    },
    response: setPortalFollowFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "feedback",
        "getPortalPost",
      ),
    ],
  });
});
