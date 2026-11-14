import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPostTags } from "./set-post-tags";
import { setPostTagsFixture } from "./set-post-tags.fixture";
describe("setPostTags", () => {
  describeOperationContract({
    operationId: "setQuillsPostTags",
    operation: setPostTags,
    request: {
      param: { workspaceId: "workspace_test_1", postId: "post-id_test_1" },
      json: { tagIds: [] },
    },
    response: setPostTagsFixture.ok(),
    method: "put",
    path: "/api/quills/workspace_test_1/posts/post-id_test_1/tags",
    statuses: [401, 403, 404, 409, 429],
  });
});
