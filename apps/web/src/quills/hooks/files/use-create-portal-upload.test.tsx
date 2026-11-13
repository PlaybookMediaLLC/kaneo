import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createPortalUploadFixture } from "../../api/files/create-portal-upload.fixture";
import { useCreatePortalUpload } from "./use-create-portal-upload";
describe("useCreatePortalUpload", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreatePortalUpload,
    operationId: "createQuillsPortalUpload",
    request: {
      param: { workspace: "workspace_test_1" },
      json: {
        purpose: "customer_file",
        filename: "value",
        contentType: "value",
        size: 0,
      },
    },
    response: createPortalUploadFixture.ok(),
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
