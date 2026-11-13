import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterArticleFixture } from "../../api/help-center/get-public-help-center-article.fixture";
import { getPublicHelpCenterCategoryFixture } from "../../api/help-center/get-public-help-center-category.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { meta } from "./meta";
import { HelpCenterCategoryPage } from "./help-center-category-page";
describe("HelpCenterCategoryPage", () => {
  const options = { params: { locale: "en", idSlug: "1-guides" } };
  describePageContract(meta, HelpCenterCategoryPage, {
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
        const article = getPublicHelpCenterArticleFixture.ok().article;
        mockApi().reply(
          getPublicHelpCenterCategoryFixture.ok({
            category: {
              ...getPublicHelpCenterCategoryFixture.ok().category,
              name: "Guides",
            },
            articles: [article],
          }),
        );
        return options;
      },
      assert: async (view) => {
        await view.findByRole("heading", { name: "Guides" });
      },
    },
  });
  describe("behavior", () => {
    it("uses the gated category endpoint", () => {
      expect(meta.operations).toContain("getQuillsPublicHelpCenterCategory");
    });
  });
});
