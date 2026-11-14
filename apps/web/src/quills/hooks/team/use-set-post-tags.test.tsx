import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setPostTagsFixture } from "../../api/team/set-post-tags.fixture";
import { useSetPostTags } from "./use-set-post-tags";
describe("useSetPostTags", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetPostTags,
    operationId: "setQuillsPostTags",
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { tagIds: [] },
    },
    response: setPostTagsFixture.ok(),
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
    ],
  });
});
