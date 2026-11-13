import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicUserProfile } from "./get-public-user-profile";
import { getPublicUserProfileFixture } from "./get-public-user-profile.fixture";
describe("getPublicUserProfile", () => {
  describeOperationContract({
    operationId: "getQuillsPublicUserProfile",
    operation: getPublicUserProfile,
    request: {
      param: {
        workspace: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: getPublicUserProfileFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/profiles/principal-id_test_1",
    statuses: [403, 404],
  });
});
