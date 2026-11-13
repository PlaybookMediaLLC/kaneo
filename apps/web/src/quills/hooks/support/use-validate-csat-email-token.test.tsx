import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { validateCsatEmailTokenFixture } from "../../api/support/validate-csat-email-token.fixture";
import { useValidateCsatEmailToken } from "./use-validate-csat-email-token";
describe("useValidateCsatEmailToken", () => {
  describeHookContract({
    kind: "query",
    hook: useValidateCsatEmailToken,
    operationId: "validateQuillsCsatEmailToken",
    request: {
      param: { workspace: "workspace_test_1" },
      query: { token: "mail_link_value" },
    },
    emptyRequest: {
      param: { workspace: "" },
      query: { token: "mail_link_value" },
    },
    response: validateCsatEmailTokenFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
