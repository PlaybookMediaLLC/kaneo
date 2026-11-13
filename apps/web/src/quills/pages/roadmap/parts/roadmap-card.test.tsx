import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { RoadmapCard } from "./roadmap-card";

const post = {
  id: "post_test_1",
  title: "Linear sync",
  voteCount: 4,
  commentCount: 2,
  eta: null,
  board: { name: "Integrations" },
};

describe("RoadmapCard", () => {
  it("links the post and shows its board, votes and comments", () => {
    const onVote = vi.fn(async () => undefined);
    const view = renderComponent(
      <RoadmapCard
        post={post}
        workspaceId="workspace_test_1"
        voted={false}
        canVote
        voting={false}
        voteProblem={null}
        onRetryVote={vi.fn()}
        onVote={onVote}
      />,
    );
    expect(view.getByRole("link", { name: "Linear sync" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/posts/post_test_1",
    );
    expect(view.getByText("Integrations")).toBeInTheDocument();
    expect(view.getByText("4 votes")).toBeInTheDocument();
    expect(view.getByText("2 comments")).toBeInTheDocument();
    press("Vote");
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it("removes a vote the viewer already gave", () => {
    const onVote = vi.fn(async () => undefined);
    renderComponent(
      <RoadmapCard
        post={post}
        workspaceId="workspace_test_1"
        voted
        canVote
        voting={false}
        voteProblem={null}
        onRetryVote={vi.fn()}
        onVote={onVote}
      />,
    );
    press("Remove vote");
    expect(onVote).toHaveBeenCalledWith(false);
  });

  it("disables voting when the board does not allow it", () => {
    const view = renderComponent(
      <RoadmapCard
        post={post}
        workspaceId="workspace_test_1"
        voted={false}
        canVote={false}
        voting={false}
        voteProblem={null}
        onRetryVote={vi.fn()}
        onVote={vi.fn()}
      />,
    );
    expect(view.getByRole("button", { name: "Vote" })).toBeDisabled();
  });
});
