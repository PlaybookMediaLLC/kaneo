import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { improvePortalPostDraftFixture } from "../../api/feedback/improve-portal-post-draft.fixture";
import { useImprovePortalPostDraft } from "./use-improve-portal-post-draft";
describe("useImprovePortalPostDraft", () => {
  describeHookContract({
    kind: "query",
    hook: useImprovePortalPostDraft,
    operationId: "improveQuillsPortalPostDraft",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { title: "value", details: "value" },
    },
    emptyRequest: {
      param: { workspace: "" },
      json: { title: "value", details: "value" },
    },
    response: improvePortalPostDraftFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
