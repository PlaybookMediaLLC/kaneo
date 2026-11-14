import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { improvePortalPostDraft } from "./improve-portal-post-draft";
import { improvePortalPostDraftFixture } from "./improve-portal-post-draft.fixture";
describe("improvePortalPostDraft", () => {
  describeOperationContract({
    operationId: "improveQuillsPortalPostDraft",
    operation: improvePortalPostDraft,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { title: "value", details: "value" },
    },
    response: improvePortalPostDraftFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/post-draft/improve",
    statuses: [401, 403, 404, 409, 429, 502],
  });
});
