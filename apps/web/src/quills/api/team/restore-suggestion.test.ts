import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { restoreSuggestion } from "./restore-suggestion";
import { restoreSuggestionFixture } from "./restore-suggestion.fixture";
describe("restoreSuggestion", () => {
  describeOperationContract({
    operationId: "restoreQuillsSuggestion",
    operation: restoreSuggestion,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        suggestionId: "suggestion-id_test_1",
      },
    },
    response: restoreSuggestionFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/suggestions/suggestion-id_test_1/restore",
    statuses: [401, 403, 404, 409, 429],
  });
});
