import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPublicHelpCenterCategoryArticles } from "./list-public-help-center-category-articles";
import { listPublicHelpCenterCategoryArticlesFixture } from "./list-public-help-center-category-articles.fixture";
describe("listPublicHelpCenterCategoryArticles", () => {
  describeOperationContract({
    operationId: "listQuillsPublicHelpCenterCategoryArticles",
    operation: listPublicHelpCenterCategoryArticles,
    request: {
      param: {
        workspace: "workspace_test_1",
        categoryId: "category-id_test_1",
      },
    },
    response: listPublicHelpCenterCategoryArticlesFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/hc/categories/category-id_test_1/articles",
    statuses: [403, 404],
  });
});
