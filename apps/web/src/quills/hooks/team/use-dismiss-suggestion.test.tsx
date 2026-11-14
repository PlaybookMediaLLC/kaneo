import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { dismissSuggestionFixture } from "../../api/team/dismiss-suggestion.fixture";
import { useDismissSuggestion } from "./use-dismiss-suggestion";
describe("useDismissSuggestion", () => {
  describeHookContract({
    kind: "mutation",
    hook: useDismissSuggestion,
    operationId: "dismissQuillsSuggestion",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        suggestionId: "suggestion-id_test_1",
      },
    },
    response: dismissSuggestionFixture.ok(),
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
