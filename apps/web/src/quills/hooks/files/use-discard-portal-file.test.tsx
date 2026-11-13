import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { discardPortalFileFixture } from "../../api/files/discard-portal-file.fixture";
import { useDiscardPortalFile } from "./use-discard-portal-file";
describe("useDiscardPortalFile", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDiscardPortalFile,
    operationId: "discardQuillsPortalFile",
    request: {
      param: { workspace: "workspace_test_1", fileId: "file-id_test_1" },
    },
    response: discardPortalFileFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "files",
        "getPortalFile",
      ),
    ],
  });
});
