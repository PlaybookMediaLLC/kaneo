import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { createConversationViewFixture } from "../../api/team/create-conversation-view.fixture";
import { useCreateConversationView } from "./use-create-conversation-view";
describe("useCreateConversationView", () => {
  describeHookContract({
    kind: "mutation",
    hook: useCreateConversationView,
    operationId: "createQuillsConversationView",
    request: {
      param: { workspaceId: "workspace_test_1" },
      json: { name: "value", filters: { rules: [] } },
    },
    response: createConversationViewFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listConversationViews",
      ),
    ],
  });
});
