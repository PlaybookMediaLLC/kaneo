import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { listTags } from "./list-tags";
import { listTagsFixture } from "./list-tags.fixture";
describe("listTags", () => {
  describeOperationContract({
    operationId: "listQuillsTags",
    operation: listTags,
    request: { param: { workspaceId: "workspace_test_1" } },
    response: listTagsFixture.ok(),
    method: "get",
    path: "/api/quills/workspace_test_1/tags",
    statuses: [401, 403, 429],
  });
});
