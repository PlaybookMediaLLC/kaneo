import { describe, expect, it } from "vite-plus/test";
import { getPublicStatusPageFixture } from "../../api/status/get-public-status-page.fixture";
import { listPublicStatusHistoryFixture } from "../../api/status/list-public-status-history.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { StatusPage } from "./status-page";
describe("StatusPage", () => {
  describePageContract(meta, StatusPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(getPublicStatusPageFixture.ok());
        api.reply(listPublicStatusHistoryFixture.ok());
        return { accessGranted: false };
      },
      assert: async (view) => {
        await view.findByText("All systems operational");
      },
    },
  });
  describe("behavior", () => {
    it("shows public status when private portal access is denied", async () => {
      const api = mockApi();
      api.reply(getPublicStatusPageFixture.ok());
      api.reply(listPublicStatusHistoryFixture.ok());
      const view = renderPage(StatusPage, meta, { accessGranted: false });
      expect(
        await view.findByText("All systems operational"),
      ).toBeInTheDocument();
      expect(api.calls("getQuillsPublicStatusPage")).toHaveLength(1);
    });
  });
});
