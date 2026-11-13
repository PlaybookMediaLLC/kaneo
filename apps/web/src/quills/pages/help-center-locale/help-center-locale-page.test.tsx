import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterFixture } from "../../api/help-center/get-public-help-center.fixture";
import { searchPublicHelpCenterFixture } from "../../api/help-center/search-public-help-center.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { meta } from "./meta";
import { HelpCenterLocalePage } from "./help-center-locale-page";
describe("HelpCenterLocalePage", () => {
  const locale = { params: { locale: "fr" } };
  describePageContract(meta, HelpCenterLocalePage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return locale;
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return locale;
      },
    },
    ready: {
      prepare: () => {
        mockApi().reply(
          getPublicHelpCenterFixture.ok({ homepageTitle: "Centre d’aide" }),
        );
        return locale;
      },
      assert: async (view) => {
        await view.findByText("Centre d’aide");
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(getPublicHelpCenterFixture.ok());
        api.reply(searchPublicHelpCenterFixture.ok());
        return { ...locale, search: { query: "facturation" } };
      },
      assert: async (view) => {
        await view.findByRole("heading", { name: "Search results" });
      },
    },
  });
  describe("behavior", () => {
    it("keeps locale in the route", () => {
      expect(meta.route).toContain("$locale");
    });
  });
});
