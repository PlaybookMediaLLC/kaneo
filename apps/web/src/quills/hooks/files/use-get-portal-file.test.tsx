import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPortalFileFixture } from "../../api/files/get-portal-file.fixture";
import { useGetPortalFile } from "./use-get-portal-file";
describe("useGetPortalFile", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPortalFile,
    operationId: "getQuillsPortalFile",
    request: {
      param: { workspace: "workspace_test_1", fileId: "file-id_test_1" },
    },
    emptyRequest: { param: { workspace: "", fileId: "file-id_test_1" } },
    response: getPortalFileFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
