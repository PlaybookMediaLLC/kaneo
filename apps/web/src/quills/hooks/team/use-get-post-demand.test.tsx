import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPostDemandFixture } from "../../api/team/get-post-demand.fixture";
import { useGetPostDemand } from "./use-get-post-demand";
describe("useGetPostDemand", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPostDemand,
    operationId: "getQuillsPostDemand",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
    },
    emptyRequest: { param: { workspaceId: "", postId: "post-id_test_1" } },
    response: getPostDemandFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
