import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listMergeSuggestionsFixture } from "../../api/team/list-merge-suggestions.fixture";
import { useListMergeSuggestions } from "./use-list-merge-suggestions";
describe("useListMergeSuggestions", () => {
  describeHookContract({
    kind: "query",
    hook: useListMergeSuggestions,
    operationId: "listQuillsMergeSuggestions",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listMergeSuggestionsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
    paged: { cursor: 20 },
  });
});
