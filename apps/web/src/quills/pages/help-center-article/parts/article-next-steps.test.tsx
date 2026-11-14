import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { ArticleNextSteps } from "./article-next-steps";

const articles = [
  { id: "a1", title: "Invite your team", path: "/hc/en/articles/1-invite" },
  { id: "a2", title: "Member roles", path: "/hc/en/articles/2-roles" },
  { id: "a3", title: "Branding", path: "/hc/en/articles/3-branding" },
];

describe("ArticleNextSteps", () => {
  it("links the previous and next articles of the collection", () => {
    const view = renderComponent(
      <ArticleNextSteps
        workspaceId="workspace_test_1"
        articleId="a2"
        articles={articles}
      />,
    );
    expect(
      view.getByRole("link", { name: /Invite your team/ }),
    ).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc/en/articles/1-invite",
    );
    expect(view.getByRole("link", { name: /Branding/ })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc/en/articles/3-branding",
    );
  });

  it("offers feedback and support when the article did not help", () => {
    const view = renderComponent(
      <ArticleNextSteps
        workspaceId="workspace_test_1"
        articleId="a1"
        articles={[articles[0]!]}
      />,
    );
    expect(
      view.queryByRole("navigation", { name: "More articles" }),
    ).not.toBeInTheDocument();
    expect(view.getByRole("link", { name: "Submit feedback" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1?openFeedback=1",
    );
    expect(view.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/support",
    );
  });
});
