import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { resolvePublicHelpCenterRedirectFixture } from "../../api/help-center/resolve-public-help-center-redirect.fixture";
import { useResolvePublicHelpCenterRedirect } from "./use-resolve-public-help-center-redirect";
describe("useResolvePublicHelpCenterRedirect", () => {
  describeHookContract({
    kind: "query",
    hook: useResolvePublicHelpCenterRedirect,
    operationId: "resolveQuillsPublicHelpCenterRedirect",
    request: {
      param: { workspace: "workspace_test_1" },
      query: { path: "value" },
    },
    emptyRequest: { param: { workspace: "" }, query: { path: "value" } },
    response: resolvePublicHelpCenterRedirectFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
