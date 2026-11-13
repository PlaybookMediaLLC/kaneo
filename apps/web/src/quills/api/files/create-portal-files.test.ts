import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createPortalFiles } from "./create-portal-files";
import { createPortalFilesFixture } from "./create-portal-files.fixture";
describe("createPortalFiles", () => {
  describeOperationContract({
    operationId: "createQuillsPortalFiles",
    operation: createPortalFiles,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { key: "value", contentType: "value", size: 0, name: "value" },
    },
    response: createPortalFilesFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/files",
    statuses: [401, 403, 404, 409, 429],
  });
});
