import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listLinksFixture } from "../../api/team/list-links.fixture";
import { useListLinks } from "./use-list-links";
describe("useListLinks", () => {
  describeHookContract({
    kind: "query",
    hook: useListLinks,
    operationId: "listQuillsLinks",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listLinksFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
