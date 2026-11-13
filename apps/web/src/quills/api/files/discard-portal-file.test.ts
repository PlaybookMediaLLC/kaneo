import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { discardPortalFile } from "./discard-portal-file";
import { discardPortalFileFixture } from "./discard-portal-file.fixture";
describe("discardPortalFile", () => {
  describeOperationContract({
    operationId: "discardQuillsPortalFile",
    operation: discardPortalFile,
    request: {
      param: { workspace: "workspace_test_1", fileId: "file-id_test_1" },
    },
    response: discardPortalFileFixture.ok(),
    method: "delete",
    path: "/api/quills-public/workspace_test_1/portal/files/file-id_test_1",
    statuses: [401, 403, 404],
  });
});
