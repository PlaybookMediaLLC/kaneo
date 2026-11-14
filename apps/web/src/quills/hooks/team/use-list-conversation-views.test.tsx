import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listConversationViewsFixture } from "../../api/team/list-conversation-views.fixture";
import { useListConversationViews } from "./use-list-conversation-views";
describe("useListConversationViews", () => {
  describeHookContract({
    kind: "query",
    hook: useListConversationViews,
    operationId: "listQuillsConversationViews",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listConversationViewsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
