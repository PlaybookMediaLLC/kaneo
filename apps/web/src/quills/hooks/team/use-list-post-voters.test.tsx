import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPostVotersFixture } from "../../api/team/list-post-voters.fixture";
import { useListPostVoters } from "./use-list-post-voters";
describe("useListPostVoters", () => {
  describeHookContract({
    kind: "query",
    hook: useListPostVoters,
    operationId: "listQuillsPostVoters",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", postId: "post-id_test_1" } },
    response: listPostVotersFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
