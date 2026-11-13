import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { preparePortalUpload } from "./prepare-portal-upload";
import { preparePortalUploadFixture } from "./prepare-portal-upload.fixture";
describe("preparePortalUpload", () => {
  describeOperationContract({
    operationId: "prepareQuillsPortalUpload",
    operation: preparePortalUpload,
    request: { param: { workspace: "workspace_test_1" } },
    response: preparePortalUploadFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/uploads/prepare",
    statuses: [401, 403, 404, 429],
  });
});
