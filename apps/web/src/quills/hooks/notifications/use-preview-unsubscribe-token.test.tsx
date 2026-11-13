import { previewUnsubscribeTokenFixture } from "../../api/notifications/preview-unsubscribe-token.fixture";
import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { usePreviewUnsubscribeToken } from "./use-preview-unsubscribe-token";
describe("usePreviewUnsubscribeToken", () => {
  describeHookContract({
    kind: "query",
    hook: usePreviewUnsubscribeToken,
    operationId: "previewQuillsUnsubscribeToken",
    request: {
      param: { workspace: "workspace_test_1" },
      query: { token: "mail_link_value" },
    },
    emptyRequest: {
      param: { workspace: "" },
      query: { token: "mail_link_value" },
    },
    response: previewUnsubscribeTokenFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
