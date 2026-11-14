import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { dismissSuggestion } from "./dismiss-suggestion";
import { dismissSuggestionFixture } from "./dismiss-suggestion.fixture";
describe("dismissSuggestion", () => {
  describeOperationContract({
    operationId: "dismissQuillsSuggestion",
    operation: dismissSuggestion,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        suggestionId: "suggestion-id_test_1",
      },
    },
    response: dismissSuggestionFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/suggestions/suggestion-id_test_1/dismiss",
    statuses: [401, 403, 404, 409, 429],
  });
});
