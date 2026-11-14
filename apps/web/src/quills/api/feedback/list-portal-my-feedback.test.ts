import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listPortalMyFeedback } from "./list-portal-my-feedback";
import { listPortalMyFeedbackFixture } from "./list-portal-my-feedback.fixture";
describe("listPortalMyFeedback", () => {
  describeOperationContract({
    operationId: "listQuillsPortalMyFeedback",
    operation: listPortalMyFeedback,
    request: { param: { workspace: "workspace_test_1" } },
    response: listPortalMyFeedbackFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/portal/my-feedback",
    statuses: [401, 403, 404],
  });
});
