import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { processUnsubscribeToken } from "./process-unsubscribe-token";
import { processUnsubscribeTokenFixture } from "./process-unsubscribe-token.fixture";
describe("processUnsubscribeToken", () => {
  describeOperationContract({
    operationId: "processQuillsUnsubscribeToken",
    operation: processUnsubscribeToken,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { token: "mail_link_value" },
    },
    response: processUnsubscribeTokenFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/unsubscribe/confirm",
    statuses: [404],
  });
});
