import { quillsOperationKey } from "../../api/keys";
import { processUnsubscribeTokenFixture } from "../../api/notifications/process-unsubscribe-token.fixture";
import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { useProcessUnsubscribeToken } from "./use-process-unsubscribe-token";
describe("useProcessUnsubscribeToken", () => {
  describeHookContract({
    kind: "mutation",
    hook: useProcessUnsubscribeToken,
    operationId: "processQuillsUnsubscribeToken",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { token: "mail_link_value" },
    },
    response: processUnsubscribeTokenFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "notifications",
        "previewUnsubscribeToken",
      ),
    ],
  });
});
