import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { acceptSuggestion } from "./accept-suggestion";
import { acceptSuggestionFixture } from "./accept-suggestion.fixture";
describe("acceptSuggestion", () => {
  describeOperationContract({
    operationId: "acceptQuillsSuggestion",
    operation: acceptSuggestion,
    request: {
      param: {
        workspaceId: "workspace_test_1",
        suggestionId: "suggestion-id_test_1",
      },
      json: { swapDirection: false },
    },
    response: acceptSuggestionFixture.ok(),
    method: "post",
    path: "/api/quills/workspace_test_1/suggestions/suggestion-id_test_1/accept",
    statuses: [401, 403, 404, 409, 429],
  });
});
