import { fixture } from "../../framework/contract";
import { all, by, seed, type Ids } from "./seed.fixture";

export const listQuillsStatusIncidents = all;
export const getQuillsStatusIncident = by("incidentId");
export const createQuillsStatusIncident = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      kind: "incident",
      title: "Elevated errors",
      status: "investigating",
      affectedComponents: [
        { componentId: a.otherComponentId, componentStatus: "major_outage" },
      ],
      body: "We are looking into it",
      templateId: a.templateId,
    },
  }),
  foreign: ({ b }: Ids) => ({ templateId: b.templateId }),
});
export const updateQuillsStatusIncident = by("incidentId", undefined, {
  title: "Renamed",
});
export const postQuillsStatusIncidentUpdate = by("incidentId", undefined, {
  status: "resolved",
  body: "Fixed",
});
export const startQuillsStatusMaintenance = by(
  "incidentId",
  (side) => side.maintenanceId,
);
export const deleteQuillsStatusIncident = by("incidentId");
