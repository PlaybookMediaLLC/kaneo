import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPostScoreFixture } from "../../api/team/set-post-score.fixture";
import { useSetPostScore } from "./use-set-post-score";
describe("useSetPostScore", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPostScore,
    operationId: "setQuillsPostScore",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { reach: null, impact: 0.25, confidence: null, effort: null },
    },
    response: setPostScoreFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPosts",
      ),
    ],
  });
});
