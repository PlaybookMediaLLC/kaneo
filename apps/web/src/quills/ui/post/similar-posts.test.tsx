import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
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

  it("offers a vote on the chosen matches that the viewer has not voted for", async () => {
    const onVote = vi.fn(async () => undefined);
    const view = renderComponent(
      <SimilarPosts
        workspaceId="workspace_test_1"
        voteIds={new Set(["post_test_1", "post_test_2"])}
        votedIds={new Set(["post_test_2"])}
        onVote={onVote}
        posts={[
          { id: "post_test_1", title: "Dark mode", voteCount: 4, stage: null },
          { id: "post_test_2", title: "CSV export", voteCount: 2, stage: null },
          { id: "post_test_3", title: "Slack", voteCount: 1, stage: null },
        ]}
      />,
    );
    expect(view.getAllByRole("button")).toHaveLength(1);
    press("Vote for this instead: Dark mode");
    await waitFor(() => expect(onVote).toHaveBeenCalledWith("post_test_1"));
  });

  it("renders nothing without matches", () => {
    const view = renderComponent(
      <SimilarPosts workspaceId="workspace_test_1" posts={[]} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });
});
