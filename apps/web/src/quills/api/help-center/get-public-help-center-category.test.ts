import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicHelpCenterCategory } from "./get-public-help-center-category";
import { getPublicHelpCenterCategoryFixture } from "./get-public-help-center-category.fixture";
describe("getPublicHelpCenterCategory", () => {
  describeOperationContract({
    operationId: "getQuillsPublicHelpCenterCategory",
    operation: getPublicHelpCenterCategory,
    request: {
      param: { workspace: "workspace_test_1", categorySlug: "value" },
    },
    response: getPublicHelpCenterCategoryFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/hc/categories/value",
    statuses: [403, 404],
  });
});
