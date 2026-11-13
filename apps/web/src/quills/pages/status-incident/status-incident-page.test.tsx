import { describe, expect, it } from "vite-plus/test";
import { getPublicStatusIncidentFixture } from "../../api/status/get-public-status-incident.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { StatusIncidentPage } from "./status-incident-page";
describe("StatusIncidentPage", () => {
  const options = { params: { incidentId: "status_incident_test_1" } };
  describePageContract(meta, StatusIncidentPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return options;
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return options;
      },
    },
    ready: {
      prepare: () => {
        mockApi().reply(
          getPublicStatusIncidentFixture.ok({ title: "Delayed notifications" }),
        );
        return { ...options, accessGranted: false };
      },
      assert: async (view) => {
        await view.findByText("Delayed notifications");
      },
    },
  });

  describe("behavior", () => {
    it("keeps a public incident visible when portal access is denied", async () => {
      const api = mockApi();
      api.reply(
        getPublicStatusIncidentFixture.ok({ title: "Delayed notifications" }),
      );
      const view = renderPage(StatusIncidentPage, meta, {
        accessGranted: false,
        params: { incidentId: "status_incident_test_1" },
      });
      expect(
        await view.findByText("Delayed notifications"),
      ).toBeInTheDocument();
      expect(api.calls("getQuillsPublicStatusIncident")).toHaveLength(1);
    });

    it("shows a non-disclosing not-found state", async () => {
      const api = mockApi();
      api.reply({ message: "Missing" }, 404);
      const view = renderPage(StatusIncidentPage, meta, {
        params: { incidentId: "missing" },
      });
      expect(await view.findByRole("alert")).toHaveTextContent(
        /could not be found/i,
      );
    });
  });
});
