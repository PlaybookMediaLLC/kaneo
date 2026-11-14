import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listConversationTags } from "./list-conversation-tags";
import { listConversationTagsFixture } from "./list-conversation-tags.fixture";
describe("listConversationTags", () => {
  describeOperationContract({
    operationId: "listQuillsConversationTags",
    operation: listConversationTags,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listConversationTagsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/conversation-tags",
    statuses: [401, 403, 404, 409, 429],
  });
});
