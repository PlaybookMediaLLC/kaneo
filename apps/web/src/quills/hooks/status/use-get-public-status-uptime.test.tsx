import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicStatusUptimeFixture } from "../../api/status/get-public-status-uptime.fixture";
import { useGetPublicStatusUptime } from "./use-get-public-status-uptime";
describe("useGetPublicStatusUptime", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicStatusUptime,
    operationId: "getQuillsPublicStatusUptime",
    request: {
      param: { workspace: "workspace_test_1" },
      query: { componentIds: "value" },
    },
    emptyRequest: {
      param: { workspace: "" },
      query: { componentIds: "value" },
    },
    response: getPublicStatusUptimeFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
