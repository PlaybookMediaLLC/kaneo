import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { createConversationView } from "./create-conversation-view";
import { createConversationViewFixture } from "./create-conversation-view.fixture";
describe("createConversationView", () => {
  describeOperationContract({
    operationId: "createQuillsConversationView",
    operation: createConversationView,
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { name: "value", filters: { rules: [] } },
    },
    response: createConversationViewFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/conversation-views",
    statuses: [401, 403, 404, 409, 429],
  });
});
