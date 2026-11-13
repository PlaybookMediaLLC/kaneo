import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicHelpCenterFixture } from "../../api/help-center/get-public-help-center.fixture";
import { useGetPublicHelpCenter } from "./use-get-public-help-center";
describe("useGetPublicHelpCenter", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicHelpCenter,
    operationId: "getQuillsPublicHelpCenter",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getPublicHelpCenterFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
