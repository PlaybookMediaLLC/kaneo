import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { translatePortalContent } from "./translate-portal-content";
import { translatePortalContentFixture } from "./translate-portal-content.fixture";
describe("translatePortalContent", () => {
  describeOperationContract({
    operationId: "translateQuillsPortalContent",
    operation: translatePortalContent,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { locale: "value" },
    },
    response: translatePortalContentFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/translations",
    statuses: [403, 404, 409, 429, 502],
  });
});
