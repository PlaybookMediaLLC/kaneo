import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicUserProfileFixture } from "../../api/portal/get-public-user-profile.fixture";
import { useGetPublicUserProfile } from "./use-get-public-user-profile";
describe("useGetPublicUserProfile", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicUserProfile,
    operationId: "getQuillsPublicUserProfile",
    request: {
      param: {
        workspace: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspace: "", principalId: "principal-id_test_1" },
    },
    response: getPublicUserProfileFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
