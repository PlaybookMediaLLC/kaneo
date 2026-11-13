import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createPortalUpload } from "./create-portal-upload";
import { createPortalUploadFixture } from "./create-portal-upload.fixture";
describe("createPortalUpload", () => {
  describeOperationContract({
    operationId: "createQuillsPortalUpload",
    operation: createPortalUpload,
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
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/uploads",
    statuses: [400, 401, 403, 404, 409, 429],
  });
});
