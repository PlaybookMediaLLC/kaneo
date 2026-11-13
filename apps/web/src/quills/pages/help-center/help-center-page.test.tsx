import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterFixture } from "../../api/help-center/get-public-help-center.fixture";
import { searchPublicHelpCenterFixture } from "../../api/help-center/search-public-help-center.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { HelpCenterPage } from "./help-center-page";
describe("HelpCenterPage", () => {
  describePageContract(meta, HelpCenterPage, {
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
        mockApi().reply(
          getPublicHelpCenterFixture.ok({ homepageTitle: "Help home" }),
        );
        return { accessGranted: false };
      },
      assert: async (view) => {
        await view.findByText("Help home");
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(getPublicHelpCenterFixture.ok());
        api.reply(searchPublicHelpCenterFixture.ok());
        return { search: { query: "billing" }, accessGranted: false };
      },
      assert: async (view) => {
        await view.findByRole("heading", { name: "Search results" });
      },
    },
  });
  describe("behavior", () => {
    it("runs search from the route query", async () => {
      const api = mockApi();
      api.reply(
        getPublicHelpCenterFixture.ok({ homepageTitle: "Product help" }),
      );
      api.reply(searchPublicHelpCenterFixture.ok());
      const view = renderPage(HelpCenterPage, meta, {
        search: { query: "reset" },
        accessGranted: false,
      });
      expect(
        await view.findByText("No articles match your search."),
      ).toBeInTheDocument();
      expect(api.calls("searchQuillsPublicHelpCenter")).toHaveLength(1);
    });
  });
});
