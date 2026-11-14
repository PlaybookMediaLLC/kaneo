import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listConversationTagsFixture } from "../../api/team/list-conversation-tags.fixture";
import { useListConversationTags } from "./use-list-conversation-tags";
describe("useListConversationTags", () => {
  describeHookContract({
    kind: "query",
    hook: useListConversationTags,
    operationId: "listQuillsConversationTags",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listConversationTagsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
