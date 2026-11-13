import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { recordCsatViaToken } from "./record-csat-via-token";
import { recordCsatViaTokenFixture } from "./record-csat-via-token.fixture";
describe("recordCsatViaToken", () => {
  describeOperationContract({
    operationId: "recordQuillsCsatViaToken",
    operation: recordCsatViaToken,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { token: "mail_link_value", rating: 1 },
    },
    response: recordCsatViaTokenFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/support/csat-email",
    statuses: [404, 429],
  });
});
