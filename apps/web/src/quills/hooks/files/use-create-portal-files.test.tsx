import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createPortalFilesFixture } from "../../api/files/create-portal-files.fixture";
import { useCreatePortalFiles } from "./use-create-portal-files";
describe("useCreatePortalFiles", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreatePortalFiles,
    operationId: "createQuillsPortalFiles",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { key: "value", contentType: "value", size: 0, name: "value" },
    },
    response: createPortalFilesFixture.ok(),
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
