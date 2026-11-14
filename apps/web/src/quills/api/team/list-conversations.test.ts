import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listConversations } from "./list-conversations";
import { listConversationsFixture } from "./list-conversations.fixture";
describe("listConversations", () => {
  describeOperationContract({
    operationId: "listQuillsConversations",
    operation: listConversations,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listConversationsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversations",
    statuses: [401, 403, 404, 409, 429],
  });
});
