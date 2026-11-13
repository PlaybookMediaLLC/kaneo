import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicHelpCenterArticle } from "./get-public-help-center-article";
import { getPublicHelpCenterArticleFixture } from "./get-public-help-center-article.fixture";
describe("getPublicHelpCenterArticle", () => {
  describeOperationContract({
    operationId: "getQuillsPublicHelpCenterArticle",
    operation: getPublicHelpCenterArticle,
    request: { param: { workspace: "workspace_test_1", idSlug: "value" } },
    response: getPublicHelpCenterArticleFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/hc/articles/value",
    statuses: [403, 404],
  });
});
