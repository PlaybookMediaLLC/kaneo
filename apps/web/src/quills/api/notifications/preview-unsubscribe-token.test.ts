import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { previewUnsubscribeToken } from "./preview-unsubscribe-token";
import { previewUnsubscribeTokenFixture } from "./preview-unsubscribe-token.fixture";
describe("previewUnsubscribeToken", () => {
  describeOperationContract({
    operationId: "previewQuillsUnsubscribeToken",
    operation: previewUnsubscribeToken,
    request: {
      param: { workspace: "workspace_test_1" },
      query: { token: "mail_link_value" },
    },
    response: previewUnsubscribeTokenFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/unsubscribe",
    statuses: [404],
  });
});
