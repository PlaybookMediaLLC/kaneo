import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getPortalPostFixture } from "../api/feedback/get-portal-post.fixture";
import { listPortalPostsFixture } from "../api/feedback/list-portal-posts.fixture";
import { searchPublicHelpCenterFixture } from "../api/help-center/search-public-help-center.fixture";
import { fill, press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { PortalSearch } from "./portal-search";
import { PortalRuntimeProvider, type PortalRuntimeValue } from "./runtime";

const runtime = (granted: boolean): PortalRuntimeValue => ({
  config: {
    name: "Workspace",
    features: {
      allowAnonymous: false,
      allowEditAfterEngagement: false,
      allowDeleteAfterEngagement: false,
      showPublicEditHistory: false,
    },
    portalAccess: { isPrivate: !granted },
    branding: {
      logoUrl: null,
      theme: { themeMode: "user", light: {}, dark: {} },
      headerDisplayMode: "logo_and_name",
      headerDisplayName: null,
    },
  },
  viewer: { kind: "anonymous" },
  access: { granted, reason: granted ? "public" : "unauthorized" },
  accessLoading: false,
  accessProblem: null,
});

const article = {
  id: "article_test_1",
  urlId: 1,
  slug: "export",
  title: "Export your data",
  description: null,
  snippet: "How to export",
  path: "hc/en/articles/1-export",
  publishedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  author: null,
  category: { id: "kb_category_test_1", urlId: 1, slug: "data", name: "Data" },
};

describe("PortalSearch", () => {
  it("searches feedback and help articles after typing pauses", async () => {
    const api = mockApi();
    api.reply(
      listPortalPostsFixture.ok({
        items: [getPortalPostFixture.ok({ title: "CSV export", voteCount: 2 })],
      }),
    );
    api.reply(searchPublicHelpCenterFixture.ok({ articles: [article] }));
    const view = renderComponent(
      <PortalRuntimeProvider value={runtime(true)}>
        <PortalSearch workspaceId="workspace_test_1" />
      </PortalRuntimeProvider>,
    );
    press("Search");
    fill("Search feedback and help", "export");
    expect(
      await view.findByRole("link", { name: /CSV export/ }),
    ).toHaveAttribute("href", expect.stringContaining("/posts/"));
    expect(
      view.getByRole("link", { name: /Export your data/ }),
    ).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc/en/articles/1-export",
    );
    const posts = new URL(api.calls("listQuillsPortalPosts")[0]!.url);
    expect(posts.searchParams.get("search")).toBe("export");
  });

  it("opens with the keyboard and searches only help without portal access", async () => {
    const api = mockApi();
    api.reply(searchPublicHelpCenterFixture.ok());
    const view = renderComponent(
      <PortalRuntimeProvider value={runtime(false)}>
        <PortalSearch workspaceId="workspace_test_1" />
      </PortalRuntimeProvider>,
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fill("Search feedback and help", "export");
    expect(await view.findByText("No results found.")).toBeInTheDocument();
    expect(api.calls("listQuillsPortalPosts")).toHaveLength(0);
  });
});
