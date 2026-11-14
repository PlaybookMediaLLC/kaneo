import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterArticleFixture } from "../api/help-center/get-public-help-center-article.fixture";
import { listPublicHelpCenterCategoryArticlesFixture } from "../api/help-center/list-public-help-center-category-articles.fixture";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { HelpSidebar } from "./help-sidebar";
import { PortalRuntimeProvider, type PortalRuntimeValue } from "./runtime";

const runtime: PortalRuntimeValue = {
  config: {
    name: "Workspace",
    features: {
      allowAnonymous: false,
      allowEditAfterEngagement: false,
      allowDeleteAfterEngagement: false,
      showPublicEditHistory: false,
      ai: true,
    },
    portalAccess: { isPrivate: false },
    branding: {
      logoUrl: null,
      theme: { themeMode: "user", light: {}, dark: {} },
      headerDisplayMode: "logo_and_name",
      headerDisplayName: null,
    },
  },
  viewer: { kind: "anonymous" },
  access: { granted: true, reason: "public" },
  accessLoading: false,
  accessProblem: null,
};

describe("HelpSidebar", () => {
  it("lists each top-level category with its articles and marks the current one", async () => {
    const api = mockApi();
    const article = getPublicHelpCenterArticleFixture.ok().article;
    api.reply(
      listPublicHelpCenterCategoryArticlesFixture.ok({ articles: [article] }),
    );
    const view = renderComponent(
      <PortalRuntimeProvider value={runtime}>
        <HelpSidebar
          workspaceId="workspace_test_1"
          locale="fr"
          categories={[
            {
              id: "kb_category_test_1",
              name: "Guides",
              path: "hc/fr/collections/1-guides",
              parentId: null,
            },
            {
              id: "kb_category_test_2",
              name: "Nested",
              path: "hc/fr/collections/2-nested",
              parentId: "kb_category_test_1",
            },
          ]}
          categoryId="kb_category_test_1"
          articleId={article.id}
        />
      </PortalRuntimeProvider>,
    );
    expect(
      await view.findByRole("link", { name: "Getting started" }),
    ).toHaveAttribute("aria-current", "page");
    expect(view.getByRole("link", { name: "Guides" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(
      view.queryByRole("link", { name: "Nested" }),
    ).not.toBeInTheDocument();
    const [request] = api.calls("listQuillsPublicHelpCenterCategoryArticles");
    expect(new URL(request!.url).searchParams.get("locale")).toBe("fr");
  });
});
