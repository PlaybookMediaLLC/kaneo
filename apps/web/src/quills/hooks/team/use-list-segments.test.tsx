import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listSegmentsFixture } from "../../api/team/list-segments.fixture";
import { useListSegments } from "./use-list-segments";
describe("useListSegments", () => {
  describeHookContract({
    kind: "query",
    hook: useListSegments,
    operationId: "listQuillsSegments",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listSegmentsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
