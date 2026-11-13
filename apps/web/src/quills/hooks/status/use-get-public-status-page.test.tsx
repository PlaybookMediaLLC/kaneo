import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicStatusPageFixture } from "../../api/status/get-public-status-page.fixture";
import { useGetPublicStatusPage } from "./use-get-public-status-page";
describe("useGetPublicStatusPage", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicStatusPage,
    operationId: "getQuillsPublicStatusPage",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getPublicStatusPageFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
