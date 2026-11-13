import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { recordPortalAccessDeniedFixture } from "../../api/portal/record-portal-access-denied.fixture";
import { useRecordPortalAccessDenied } from "./use-record-portal-access-denied";
describe("useRecordPortalAccessDenied", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRecordPortalAccessDenied,
    operationId: "recordQuillsPortalAccessDenied",
    request: { param: { workspace: "workspace_test_1" } },
    response: recordPortalAccessDeniedFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getPublicPortalConfig",
      ),
    ],
  });
});
