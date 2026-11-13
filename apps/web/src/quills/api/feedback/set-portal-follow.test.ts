import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setPortalFollow } from "./set-portal-follow";
import { setPortalFollowFixture } from "./set-portal-follow.fixture";
describe("setPortalFollow", () => {
  describeOperationContract({
    operationId: "setQuillsPortalFollow",
    operation: setPortalFollow,
    request: {
      param: { workspace: "workspace_test_1", postId: "post-id_test_1" },
      json: { following: false },
    },
    response: setPortalFollowFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/portal/posts/post-id_test_1/follow",
    statuses: [401, 403, 404, 429],
  });
});
