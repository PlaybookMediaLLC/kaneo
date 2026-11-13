import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostComment } from "./post-comment";

const comment = {
  id: "comment_test_1",
  parentId: null,
  content: "Please add exports",
  author: { name: "Morgan", avatarUrl: null, isTeamMember: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
  deleted: false,
  isAuthor: true,
  canEdit: true,
  canDelete: true,
  pending: false,
  reactions: [
    { emoji: "❤️", count: 2, reacted: true },
    { emoji: "🚀", count: 1, reacted: false },
  ],
};

describe("PostComment", () => {
  it("shows the author, likes and author actions, and opens a reply", async () => {
    const onReact = vi.fn(async () => undefined);
    const onEdit = vi.fn();
    const view = renderComponent(
      <ul>
        <PostComment
          comment={comment}
          onReact={onReact}
          onEdit={onEdit}
          replyForm={(parentId) => <p>{`Reply to ${parentId}`}</p>}
        />
      </ul>,
    );
    expect(view.getByText("Morgan")).toBeInTheDocument();
    expect(view.getByText("Team")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Like" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.getByText("2")).toBeInTheDocument();
    press("Like");
    expect(onReact).toHaveBeenCalledWith("comment_test_1", "❤️", false);
    press("Edit comment");
    expect(onEdit).toHaveBeenCalledWith("comment_test_1");
    press("Reply");
    expect(view.getByText("Reply to comment_test_1")).toBeInTheDocument();
  });

  it("hides actions on a deleted comment", () => {
    const view = renderComponent(
      <ul>
        <PostComment comment={{ ...comment, deleted: true, content: "" }} />
      </ul>,
    );
    expect(view.getByText("This comment was deleted.")).toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Like" }),
    ).not.toBeInTheDocument();
  });
});
