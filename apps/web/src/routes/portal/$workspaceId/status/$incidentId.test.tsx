import { describeRedirectContract } from "@/quills/test/contracts";
import { Route } from "./$incidentId";

describeRedirectContract({
  Route,
  params: { workspaceId: "workspace_test_1", incidentId: "incident_test_1" },
  expectedTo: "/portal/$workspaceId/status/incidents/$incidentId",
});
