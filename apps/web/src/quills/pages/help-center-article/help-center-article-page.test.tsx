import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterArticleFixture } from "../../api/help-center/get-public-help-center-article.fixture";
import { recordPublicArticleFeedbackFixture } from "../../api/help-center/record-public-article-feedback.fixture";
import { press } from "../../test/actions";
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
        expect(view.getByRole("link", { name: "Help center" })).toHaveAttribute(
          "href",
          "/portal/workspace_test_1/hc",
        );
        expect(view.getByText("Example author")).toBeInTheDocument();
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(getPublicHelpCenterArticleFixture.ok());
        api.reply(recordPublicArticleFeedbackFixture.ok({ helpful: true }));
        // The vote refetches the article.
        api.reply(getPublicHelpCenterArticleFixture.ok());
        return options;
      },
      act: async (view) => {
        await view.findByRole("heading", { name: "Getting started" });
        press("Yes");
        await view.findByText("Thanks for the feedback.");
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
