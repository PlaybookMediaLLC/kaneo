import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { resolvePublicHelpCenterRedirect } from "./resolve-public-help-center-redirect";
import { resolvePublicHelpCenterRedirectFixture } from "./resolve-public-help-center-redirect.fixture";
describe("resolvePublicHelpCenterRedirect", () => {
  describeOperationContract({
    operationId: "resolveQuillsPublicHelpCenterRedirect",
    operation: resolvePublicHelpCenterRedirect,
    request: {
      param: { workspace: "workspace_test_1" },
      query: { path: "value" },
    },
    response: resolvePublicHelpCenterRedirectFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/hc/redirect",
    statuses: [403, 404],
  });
});
