import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { acceptSuggestionFixture } from "../../api/team/accept-suggestion.fixture";
import { useAcceptSuggestion } from "./use-accept-suggestion";
describe("useAcceptSuggestion", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAcceptSuggestion,
    operationId: "acceptQuillsSuggestion",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        suggestionId: "suggestion-id_test_1",
      },
      json: { swapDirection: false },
    },
    response: acceptSuggestionFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "team",
        "listMergeSuggestions",
      ),
    ],
  });
});
