import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getPublicStatusIncidentFixture } from "../../api/status/get-public-status-incident.fixture";
import { useGetPublicStatusIncident } from "./use-get-public-status-incident";
describe("useGetPublicStatusIncident", () => {
  describeHookContract({
    kind: "query",
    hook: useGetPublicStatusIncident,
    operationId: "getQuillsPublicStatusIncident",
    request: {
      param: {
        workspace: "workspace_test_1",
        incidentId: "incident-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspace: "", incidentId: "incident-id_test_1" },
    },
    response: getPublicStatusIncidentFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
