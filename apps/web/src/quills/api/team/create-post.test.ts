import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createPost } from "./create-post";
import { createPostFixture } from "./create-post.fixture";
describe("createPost", () => {
  describeOperationContract({
    operationId: "createQuillsPost",
    operation: createPost,
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { boardId: "board_id_test_1", title: "value" },
    },
    response: createPostFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/posts",
    statuses: [401, 403, 404, 409, 429],
  });
});
