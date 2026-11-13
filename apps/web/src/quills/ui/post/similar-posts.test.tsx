import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { SimilarPosts } from "./similar-posts";

describe("SimilarPosts", () => {
  it("links each match with its vote count", () => {
    const view = renderComponent(
      <SimilarPosts
        workspaceId="workspace_test_1"
        posts={[
          {
            id: "post_test_1",
            title: "Linear sync",
            voteCount: 4,
            stage: "planned",
          },
        ]}
      />,
    );
    expect(
      view.getByRole("heading", { name: "Similar posts" }),
    ).toBeInTheDocument();
    expect(view.getByRole("link", { name: /Linear sync/ })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/posts/post_test_1",
    );
    expect(view.getByText("4 votes")).toBeInTheDocument();
  });

  it("marks the posts the viewer voted for", () => {
    const view = renderComponent(
      <SimilarPosts
        workspaceId="workspace_test_1"
        votedIds={new Set(["post_test_2"])}
        posts={[
          {
            id: "post_test_1",
            title: "Linear sync",
            voteCount: 4,
            stage: null,
          },
          { id: "post_test_2", title: "CSV export", voteCount: 2, stage: null },
        ]}
      />,
    );
    expect(view.getByRole("link", { name: /CSV export/ })).toHaveTextContent(
      "You voted",
    );
    expect(
      view.getByRole("link", { name: /Linear sync/ }),
    ).not.toHaveTextContent("You voted");
  });

  it("renders nothing without matches", () => {
    const view = renderComponent(
      <SimilarPosts workspaceId="workspace_test_1" posts={[]} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });
});
