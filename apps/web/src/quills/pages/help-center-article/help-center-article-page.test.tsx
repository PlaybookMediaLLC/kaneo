import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterArticleFixture } from "../../api/help-center/get-public-help-center-article.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { HelpCenterArticlePage } from "./help-center-article-page";
describe("HelpCenterArticlePage", () => {
  const options = { params: { locale: "en", idSlug: "1-getting-started" } };
  describePageContract(meta, HelpCenterArticlePage, {
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
        mockApi().reply(getPublicHelpCenterArticleFixture.ok());
        return { ...options, accessGranted: false };
      },
      assert: async (view) => {
        await view.findByRole("heading", { name: "Getting started" });
      },
    },
  });
  describe("behavior", () => {
    it("does not distinguish inaccessible and deleted articles", async () => {
      const api = mockApi();
      api.reply({ message: "Article not found" }, 404);
      const view = renderPage(HelpCenterArticlePage, meta, {
        params: { locale: "en", idSlug: "1-private" },
      });
      expect(await view.findByRole("alert")).toHaveTextContent(
        /could not be found/i,
      );
      expect(api.calls("getQuillsPublicHelpCenterArticle")).toHaveLength(1);
    });
  });
});
