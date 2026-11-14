import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPrincipalsFixture } from "../../api/team/list-principals.fixture";
import { useListPrincipals } from "./use-list-principals";
describe("useListPrincipals", () => {
  describeHookContract({
    kind: "query",
    hook: useListPrincipals,
    operationId: "listQuillsPrincipals",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listPrincipalsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
