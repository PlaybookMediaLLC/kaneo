import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { preparePortalUploadFixture } from "../../api/files/prepare-portal-upload.fixture";
import { usePreparePortalUpload } from "./use-prepare-portal-upload";
describe("usePreparePortalUpload", () => {
  describeHookContract({
    kind: "mutation",
    hook: usePreparePortalUpload,
    operationId: "prepareQuillsPortalUpload",
    request: { param: { workspace: "workspace_test_1" } },
    response: preparePortalUploadFixture.ok(),
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
