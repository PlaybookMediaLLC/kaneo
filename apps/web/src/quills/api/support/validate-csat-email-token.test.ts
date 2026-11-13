import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { validateCsatEmailToken } from "./validate-csat-email-token";
import { validateCsatEmailTokenFixture } from "./validate-csat-email-token.fixture";
describe("validateCsatEmailToken", () => {
  describeOperationContract({
    operationId: "validateQuillsCsatEmailToken",
    operation: validateCsatEmailToken,
    request: {
      param: { workspace: "workspace_test_1" },
      query: { token: "mail_link_value" },
    },
    response: validateCsatEmailTokenFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/support/csat-email",
    statuses: [404],
  });
});
