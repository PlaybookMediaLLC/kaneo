import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listMyConversationsFixture } from "../../api/support/list-my-conversations.fixture";
import { useListMyConversations } from "./use-list-my-conversations";
describe("useListMyConversations", () => {
  describeHookContract({
    kind: "query",
    hook: useListMyConversations,
    operationId: "listQuillsMyConversations",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listMyConversationsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: "conversation_cursor_test_2" },
  });
});
