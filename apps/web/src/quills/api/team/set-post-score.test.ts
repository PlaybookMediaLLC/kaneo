import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPostScore } from "./set-post-score";
import { setPostScoreFixture } from "./set-post-score.fixture";
describe("setPostScore", () => {
  describeOperationContract({
    operationId: "setQuillsPostScore",
    operation: setPostScore,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { reach: null, impact: 0.25, confidence: null, effort: null },
    },
    response: setPostScoreFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/score",
    statuses: [401, 403, 404, 429],
  });
});
