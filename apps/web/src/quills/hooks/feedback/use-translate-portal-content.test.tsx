import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { translatePortalContentFixture } from "../../api/feedback/translate-portal-content.fixture";
import { useTranslatePortalContent } from "./use-translate-portal-content";
describe("useTranslatePortalContent", () => {
  describeHookContract({
    kind: "query",
    hook: useTranslatePortalContent,
    operationId: "translateQuillsPortalContent",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { locale: "value" },
    },
    emptyRequest: { param: { workspace: "" }, json: { locale: "value" } },
    response: translatePortalContentFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
