import { expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { HelpNavigation } from "./help-navigation";
it("keeps the collection and selected article navigation in the same workspace and locale", () => {
  const view = renderComponent(
    <HelpNavigation
      workspaceId="workspace_test_1"
      locale="fr"
      categoryId="c"
      articleId="a"
      categories={[
        {
          id: "c",
          name: "Guides",
          path: "hc/fr/collections/1-guides",
          parentId: null,
        },
      ]}
      articles={[{ id: "a", title: "Start", path: "hc/fr/articles/1-start" }]}
    />,
  );
  expect(view.getByRole("link", { name: "Start" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(view.getByRole("link", { name: "Guides" })).toHaveAttribute(
    "href",
    "/portal/workspace_test_1/hc/fr/collections/1-guides",
  );
  expect(view.getByRole("button", { name: "Browse help" })).toBeInTheDocument();
});
