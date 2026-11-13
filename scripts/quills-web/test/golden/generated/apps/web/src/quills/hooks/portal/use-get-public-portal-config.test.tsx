import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicPortalConfigFixture } from "../../api/portal/get-public-portal-config.fixture";
import { useGetPublicPortalConfig } from "./use-get-public-portal-config";
describe("useGetPublicPortalConfig", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicPortalConfig,
    operationId: "getQuillsPublicPortalConfig",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getPublicPortalConfigFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
