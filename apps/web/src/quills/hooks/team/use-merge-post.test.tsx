import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { mergePostFixture } from "../../api/team/merge-post.fixture";
import { useMergePost } from "./use-merge-post";
describe("useMergePost", () => {
  describeHookContract({
    kind: "mutation",
    hook: useMergePost,
    operationId: "mergeQuillsPost",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { canonicalPostId: "canonical_post_id_test_1" },
    },
    response: mergePostFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPost",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getTeamCounts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPostFilterCounts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listMergedPosts",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listPostVoters",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getPostDemand",
      ),
    ],
  });
});
