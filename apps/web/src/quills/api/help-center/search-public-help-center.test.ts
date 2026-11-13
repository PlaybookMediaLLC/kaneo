import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { searchPublicHelpCenter } from "./search-public-help-center";
import { searchPublicHelpCenterFixture } from "./search-public-help-center.fixture";
describe("searchPublicHelpCenter", () => {
  describeOperationContract({
    operationId: "searchQuillsPublicHelpCenter",
    operation: searchPublicHelpCenter,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { query: "value" },
    },
    response: searchPublicHelpCenterFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/hc/search",
    statuses: [403, 404, 429],
  });
});
