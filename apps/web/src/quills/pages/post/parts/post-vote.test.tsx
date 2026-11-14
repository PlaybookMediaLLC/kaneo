import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { PostVote, type PostVoteProps } from "./post-vote";

const props = (over: Partial<PostVoteProps> = {}): PostVoteProps => ({
  voted: true,
  voteCount: 4,
  importance: null,
  canVote: true,
  loading: false,
  problem: null,
  thanks: false,
  onRetry: vi.fn(),
  onVote: vi.fn(async () => undefined),
  ...over,
});

describe("PostVote", () => {
  it("asks how important the post is after a vote", () => {
    const view = renderComponent(
      <PostVote {...props({ importance: "important" })} />,
    );
    const group = view.getByRole("group", { name: /how important/i });
    expect(group).toBeVisible();
    expect(view.getByRole("button", { name: "Important" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.getByRole("button", { name: "Blocker" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows no question before a vote and no count when the board hides it", () => {
    const view = renderComponent(
      <PostVote {...props({ voted: false, voteCount: undefined })} />,
    );
    expect(view.queryByRole("group")).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: /^vote$/i })).toBeVisible();
    expect(view.queryByText(/votes?$/i)).not.toBeInTheDocument();
  });

  it("sends the vote with the chosen importance", () => {
    const onVote = vi.fn(async () => undefined);
    const view = renderComponent(
      <PostVote {...props({ onVote, thanks: true })} />,
    );
    press("Blocker");
    expect(onVote).toHaveBeenCalledWith(true, "critical");
    expect(view.getByText(/thanks for your vote/i)).toHaveAttribute(
      "role",
      "status",
    );
  });
});
