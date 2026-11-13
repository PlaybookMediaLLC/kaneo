import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { recordCsatViaTokenFixture } from "../../api/support/record-csat-via-token.fixture";
import { useRecordCsatViaToken } from "./use-record-csat-via-token";
describe("useRecordCsatViaToken", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRecordCsatViaToken,
    operationId: "recordQuillsCsatViaToken",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { token: "mail_link_value", rating: 1 },
    },
    response: recordCsatViaTokenFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "support",
        "validateCsatEmailToken",
      ),
    ],
  });
});
