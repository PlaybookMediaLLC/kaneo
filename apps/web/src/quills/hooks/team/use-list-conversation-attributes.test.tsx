import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listConversationAttributesFixture } from "../../api/team/list-conversation-attributes.fixture";
import { useListConversationAttributes } from "./use-list-conversation-attributes";
describe("useListConversationAttributes", () => {
  describeHookContract({
    kind: "query",
    hook: useListConversationAttributes,
    operationId: "listQuillsConversationAttributes",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listConversationAttributesFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
