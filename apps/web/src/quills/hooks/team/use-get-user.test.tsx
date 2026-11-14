import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getUserFixture } from "../../api/team/get-user.fixture";
import { useGetUser } from "./use-get-user";
describe("useGetUser", () => {
  describeHookContract({
    kind: "query",
    hook: useGetUser,
    operationId: "getQuillsUser",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", principalId: "principal-id_test_1" },
    },
    response: getUserFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
