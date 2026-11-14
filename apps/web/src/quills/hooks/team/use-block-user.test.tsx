import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { blockUserFixture } from "../../api/team/block-user.fixture";
import { useBlockUser } from "./use-block-user";
describe("useBlockUser", () => {
  describeHookContract({
    kind: "mutation",
    hook: useBlockUser,
    operationId: "blockQuillsUser",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        principalId: "principal-id_test_1",
      },
    },
    response: blockUserFixture.ok(),
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
