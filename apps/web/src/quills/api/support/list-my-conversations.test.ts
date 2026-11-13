import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listMyConversations } from "./list-my-conversations";
import { listMyConversationsFixture } from "./list-my-conversations.fixture";
describe("listMyConversations", () => {
  describeOperationContract({
    operationId: "listQuillsMyConversations",
    operation: listMyConversations,
    request: { param: { workspace: "workspace_test_1" } },
    response: listMyConversationsFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/support/conversations",
    statuses: [401, 403, 404],
  });
});
