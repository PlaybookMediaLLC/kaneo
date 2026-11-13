import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPortalFile } from "./get-portal-file";
import { getPortalFileFixture } from "./get-portal-file.fixture";
describe("getPortalFile", () => {
  describeOperationContract({
    operationId: "getQuillsPortalFile",
    operation: getPortalFile,
    request: {
      param: { workspace: "workspace_test_1", fileId: "file-id_test_1" },
    },
    response: getPortalFileFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/files/file-id_test_1",
    statuses: [403, 404],
  });
});
