import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listConversationViews } from "./list-conversation-views";
import { listConversationViewsFixture } from "./list-conversation-views.fixture";
describe("listConversationViews", () => {
  describeOperationContract({
    operationId: "listQuillsConversationViews",
    operation: listConversationViews,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listConversationViewsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversation-views",
    statuses: [401, 403, 404, 409, 429],
  });
});
