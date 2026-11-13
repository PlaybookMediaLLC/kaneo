import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { RecentPostList } from "./recent-post-list";

describe("RecentPostList", () => {
  it("links a post and shows engagement", () => {
    const view = renderComponent(
      <RecentPostList
        workspaceId="workspace_test_1"
        posts={[
          {
            id: "post_test_1",
            title: "Export history",
            content: "Please add exports",
            board: { id: "board_test_1", name: "Ideas", slug: "ideas" },
            status: null,
            stage: "open",
            author: { name: "Morgan", avatarUrl: null, isTeamMember: false },
            voteCount: 4,
            commentCount: 2,
            pending: false,
            isAuthor: false,
            voted: false,
            following: false,
            tags: [],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(view.getByRole("link", { name: "Export history" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/posts/post_test_1",
    );
    expect(view.getByText("4 votes")).toBeInTheDocument();
    expect(view.getByText("2 comments")).toBeInTheDocument();
  });
});
