import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { unblockUserFixture } from "../../api/team/unblock-user.fixture";
import { useUnblockUser } from "./use-unblock-user";
describe("useUnblockUser", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUnblockUser,
    operationId: "unblockQuillsUser",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: unblockUserFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "getUser",
      ),
    ],
  });
});
