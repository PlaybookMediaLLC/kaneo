import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostList } from "./post-list";

const post = {
  id: "post_test_1",
  title: "Export history",
  content: "Please add exports",
  board: { id: "board_test_1", name: "Ideas", slug: "ideas" },
  status: null,
  stage: "open" as const,
  author: { name: "Morgan", avatarUrl: null, isTeamMember: false },
  voteCount: 4,
  commentCount: 2,
  pending: false,
  isAuthor: false,
  voted: false,
  following: false,
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("PostList", () => {
  it("votes and loads the next page", () => {
    const onVote = vi.fn();
    const onLoadMore = vi.fn();
    const view = renderComponent(
      <PostList
        posts={[post]}
        workspaceId="workspace_test_1"
        canVote
        canLoadMore
        loadingMore={false}
        onVote={onVote}
        onLoadMore={onLoadMore}
      />,
    );
    expect(
      view.getByRole("link", { name: "Export history" }),
    ).toBeInTheDocument();
    press(/^vote$/i);
    press(/load more posts/i);
    expect(onVote).toHaveBeenCalledWith(post, true);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
