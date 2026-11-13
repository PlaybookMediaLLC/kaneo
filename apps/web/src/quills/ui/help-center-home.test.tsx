import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { HelpCenterHome } from "./help-center-home";

const category = {
  id: "kb_category_test_1",
  name: "Guides",
  description: null,
  icon: null,
  articleCount: 3,
  path: "hc/en/collections/1-guides",
  parentId: null,
};

describe("HelpCenterHome", () => {
  it("shows a card per top-level category and keeps the locale in search", () => {
    const view = renderComponent(
      <HelpCenterHome
        workspaceId="workspace_test_1"
        locale="fr"
        locales={["en", "fr"]}
        categories={[
          category,
          {
            ...category,
            id: "kb_category_test_2",
            name: "Nested",
            parentId: category.id,
          },
        ]}
        popular={[]}
        searchQuery=""
      />,
    );
    expect(view.getByRole("link", { name: /Guides/ })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc/en/collections/1-guides",
    );
    expect(view.getByText("3 articles")).toBeInTheDocument();
    expect(
      view.queryByRole("link", { name: /Nested/ }),
    ).not.toBeInTheDocument();
    expect(
      view
        .getByRole("searchbox", { name: "Search the help center" })
        .closest("form"),
    ).toHaveAttribute("action", "/portal/workspace_test_1/hc/fr");
    expect(view.getByRole("link", { name: "fr" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("shows search results in place of the categories", () => {
    const view = renderComponent(
      <HelpCenterHome
        workspaceId="workspace_test_1"
        locales={["en"]}
        categories={[category]}
        popular={[]}
        results={[]}
        searchQuery="reset"
      />,
    );
    expect(
      view.getByText("No articles match your search."),
    ).toBeInTheDocument();
    expect(
      view.queryByRole("link", { name: /Guides/ }),
    ).not.toBeInTheDocument();
    expect(
      view.queryByRole("navigation", { name: "Languages" }),
    ).not.toBeInTheDocument();
  });
});
