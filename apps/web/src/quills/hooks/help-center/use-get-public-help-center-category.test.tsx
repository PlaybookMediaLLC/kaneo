import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicHelpCenterCategoryFixture } from "../../api/help-center/get-public-help-center-category.fixture";
import { useGetPublicHelpCenterCategory } from "./use-get-public-help-center-category";
describe("useGetPublicHelpCenterCategory", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicHelpCenterCategory,
    operationId: "getQuillsPublicHelpCenterCategory",
    request: {
      param: { workspace: "workspace_test_1", categorySlug: "value" },
    },
    emptyRequest: { param: { workspace: "", categorySlug: "value" } },
    response: getPublicHelpCenterCategoryFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
