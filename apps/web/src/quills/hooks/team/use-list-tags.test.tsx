import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { listTagsFixture } from "../../api/team/list-tags.fixture";
import { useListTags } from "./use-list-tags";
describe("useListTags", () => {
  describeHookContract({
    kind: "query",
    hook: useListTags,
    operationId: "listQuillsTags",
    request: { param: { workspaceId: "workspace_test_1" } },
    emptyRequest: { param: { workspaceId: "" } },
    response: listTagsFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
