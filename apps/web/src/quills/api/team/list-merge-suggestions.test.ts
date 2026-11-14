import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listMergeSuggestions } from "./list-merge-suggestions";
import { listMergeSuggestionsFixture } from "./list-merge-suggestions.fixture";
describe("listMergeSuggestions", () => {
  describeOperationContract({
    operationId: "listQuillsMergeSuggestions",
    operation: listMergeSuggestions,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listMergeSuggestionsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/merge-suggestions",
    statuses: [401, 403, 429],
  });
});
