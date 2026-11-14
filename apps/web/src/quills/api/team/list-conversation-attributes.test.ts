import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listConversationAttributes } from "./list-conversation-attributes";
import { listConversationAttributesFixture } from "./list-conversation-attributes.fixture";
describe("listConversationAttributes", () => {
  describeOperationContract({
    operationId: "listQuillsConversationAttributes",
    operation: listConversationAttributes,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listConversationAttributesFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversation-attributes",
    statuses: [401, 403, 404, 409, 429],
  });
});
