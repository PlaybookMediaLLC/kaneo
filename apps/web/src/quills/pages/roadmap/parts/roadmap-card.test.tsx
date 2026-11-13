import { describe, expect, it, vi } from "vite-plus/test";
import { getPortalPostFixture } from "../../../api/feedback/get-portal-post.fixture";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { RoadmapCard } from "./roadmap-card";

const post = getPortalPostFixture.ok({
  id: "post_test_1",
  title: "Linear sync",
  board: { id: "board_test_1", name: "Integrations", slug: "integrations" },
  author: { name: "Morgan", avatarUrl: null, isTeamMember: false },
  voteCount: 4,
});

describe("RoadmapCard", () => {
  it("links the post and shows its board, author and votes", () => {
    const onVote = vi.fn(async () => undefined);
    const view = renderComponent(
      <RoadmapCard
        post={post}
        workspaceId="workspace_test_1"
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
    expect(view.getByText("Morgan")).toBeInTheDocument();
    expect(view.getByText("4 votes")).toBeInTheDocument();
    press("Vote");
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it("disables voting when the board does not allow it", () => {
    const view = renderComponent(
      <RoadmapCard
        post={post}
        workspaceId="workspace_test_1"
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
