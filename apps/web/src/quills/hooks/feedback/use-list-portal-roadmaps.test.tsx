import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listPortalRoadmapsFixture } from "../../api/feedback/list-portal-roadmaps.fixture";
import { useListPortalRoadmaps } from "./use-list-portal-roadmaps";
describe("useListPortalRoadmaps", () => {
  describeHookContract({
    kind: "query",
    hook: useListPortalRoadmaps,
    operationId: "listQuillsPortalRoadmaps",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: listPortalRoadmapsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
