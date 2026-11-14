import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { searchPublicHelpCenterFixture } from "../api/help-center/search-public-help-center.fixture";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { HelpSuggestions } from "./help-suggestions";
import { PortalRuntimeProvider, type PortalRuntimeValue } from "./runtime";

const runtime = {
  viewer: { kind: "anonymous" },
} as unknown as PortalRuntimeValue;
const article = (n: number) => ({
  id: `article_test_${n}`,
  title: `Article ${n}`,
  path: `hc/articles/article-${n}`,
  category: { id: "category_test_1", name: "Billing", slug: "billing" },
});

const show = (title: string) => (
  <PortalRuntimeProvider value={runtime}>
    <HelpSuggestions workspaceId="workspace_test_1" title={title} />
  </PortalRuntimeProvider>
);

describe("HelpSuggestions", () => {
  it("lists the matching articles under a heading", async () => {
    const api = mockApi();
    api.reply(
      searchPublicHelpCenterFixture.ok({
        articles: [1, 2, 3].map(article),
      } as never),
    );
    const view = renderComponent(show("refund"));
    const list = await view.findByRole("region", {
      name: "These articles may answer your question",
    });
    expect(list.querySelectorAll("a")).toHaveLength(3);
    expect(view.getByRole("link", { name: /Article 1/ })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc/articles/article-1",
    );
    const [request] = api.calls("searchQuillsPublicHelpCenter");
    expect(await request!.json()).toEqual({
      query: "refund",
      limit: 3,
      record: false,
    });
  });

  it("does not search a short title", () => {
    const api = mockApi();
    renderComponent(show("ab"));
    expect(api.calls()).toHaveLength(0);
  });

  it("shows nothing and stops searching when there is no help center", async () => {
    const api = mockApi();
    api.reply(searchPublicHelpCenterFixture.problem(404).body, 404);
    const view = renderComponent(show("refund"));
    const cache = view.queryClient.getQueryCache();
    await waitFor(() =>
      expect(cache.getAll().map((query) => query.state.status)).toContain(
        "error",
      ),
    );
    view.rerender(show("refund policy"));
    // The next title builds a disabled request: no workspace, so no call.
    const next = cache
      .getAll()
      .find((query) =>
        JSON.stringify(query.queryKey).includes("refund policy"),
      );
    expect(JSON.stringify(next?.queryKey)).not.toContain("workspace_test_1");
    expect(api.calls("searchQuillsPublicHelpCenter")).toHaveLength(1);
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.container).toBeEmptyDOMElement();
  });
});
