import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPublicHelpCenterCategoryArticlesFixture } from "../../api/help-center/list-public-help-center-category-articles.fixture";
import { useListPublicHelpCenterCategoryArticles } from "./use-list-public-help-center-category-articles";
describe("useListPublicHelpCenterCategoryArticles", () => {
  describeHookContract({
    kind: "query",
    hook: useListPublicHelpCenterCategoryArticles,
    operationId: "listQuillsPublicHelpCenterCategoryArticles",
    request: {
      param: {
        workspace: "workspace_test_1",
        categoryId: "category-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspace: "", categoryId: "category-id_test_1" },
    },
    response: listPublicHelpCenterCategoryArticlesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
