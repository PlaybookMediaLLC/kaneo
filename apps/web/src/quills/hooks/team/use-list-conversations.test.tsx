import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listConversationsFixture } from "../../api/team/list-conversations.fixture";
import { useListConversations } from "./use-list-conversations";
describe("useListConversations", () => {
  describeHookContract({
    kind: "query",
    hook: useListConversations,
    operationId: "listQuillsConversations",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listConversationsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: "cursor_test_2" },
  });
});
