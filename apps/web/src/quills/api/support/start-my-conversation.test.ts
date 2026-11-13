import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { startMyConversation } from "./start-my-conversation";
import { startMyConversationFixture } from "./start-my-conversation.fixture";
describe("startMyConversation", () => {
  describeOperationContract({
    operationId: "startQuillsMyConversation",
    operation: startMyConversation,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { content: "value", idempotencyKey: "value" },
    },
    response: startMyConversationFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/support/conversations",
    statuses: [401, 403, 404, 409, 429],
  });
});
