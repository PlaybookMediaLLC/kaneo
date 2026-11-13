import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { searchPublicHelpCenterFixture } from "../../api/help-center/search-public-help-center.fixture";
import { useSearchPublicHelpCenter } from "./use-search-public-help-center";
describe("useSearchPublicHelpCenter", () => {
  describeHookContract({
    kind: "query",
    hook: useSearchPublicHelpCenter,
    operationId: "searchQuillsPublicHelpCenter",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { query: "value" },
    },
    emptyRequest: {
      param: { workspace: "workspace_test_1" },
      json: { query: "" },
    },
    response: searchPublicHelpCenterFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
