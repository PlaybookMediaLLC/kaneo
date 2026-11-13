import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicHelpCenterArticleFixture } from "../../api/help-center/get-public-help-center-article.fixture";
import { useGetPublicHelpCenterArticle } from "./use-get-public-help-center-article";
describe("useGetPublicHelpCenterArticle", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicHelpCenterArticle,
    operationId: "getQuillsPublicHelpCenterArticle",
    request: { param: { workspace: "workspace_test_1", idSlug: "value" } },
    emptyRequest: { param: { workspace: "", idSlug: "value" } },
    response: getPublicHelpCenterArticleFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
