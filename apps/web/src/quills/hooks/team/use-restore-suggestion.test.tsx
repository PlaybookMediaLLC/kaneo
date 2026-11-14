import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { restoreSuggestionFixture } from "../../api/team/restore-suggestion.fixture";
import { useRestoreSuggestion } from "./use-restore-suggestion";
describe("useRestoreSuggestion", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRestoreSuggestion,
    operationId: "restoreQuillsSuggestion",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        suggestionId: "suggestion-id_test_1",
      },
    },
    response: restoreSuggestionFixture.ok(),
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
