import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getPublicStatusIncident } from "./get-public-status-incident";
import { getPublicStatusIncidentFixture } from "./get-public-status-incident.fixture";
describe("getPublicStatusIncident", () => {
  describeOperationContract({
    operationId: "getQuillsPublicStatusIncident",
    operation: getPublicStatusIncident,
    request: {
      param: {
        workspace: "workspace_test_1",
        incidentId: "incident-id_test_1",
      },
    },
    response: getPublicStatusIncidentFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/status/incidents/incident-id_test_1",
    statuses: [403, 404],
  });
});
