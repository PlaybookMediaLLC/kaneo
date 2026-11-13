import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostComments } from "./post-comments";
describe("PostComments", () => {
  it("shows the empty state", () => {
    const view = renderComponent(<PostComments comments={[]} />);
    expect(
      view.getByRole("heading", { name: /comments/i }),
    ).toBeInTheDocument();
    expect(view.getByText(/no comments yet/i)).toBeInTheDocument();
  });

  it("renders a comment", () => {
    const view = renderComponent(
      <PostComments
        comments={[
          {
            id: "comment_test_1",
            content: "A useful reply",
            author: { name: "Morgan" },
            createdAt: "2026-01-01T00:00:00.000Z",
            deleted: false,
            isAuthor: false,
            canEdit: false,
            canDelete: false,
            pending: false,
            updatedAt: null,
          },
        ]}
      />,
    );
    expect(view.getByText("A useful reply")).toBeInTheDocument();
    expect(view.getByText(/morgan/i)).toBeInTheDocument();
  });

  it("shows only the permitted author actions", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const comment = {
      id: "comment_test_1",
      content: "A useful reply",
      author: { name: "Morgan" },
      createdAt: "2026-01-01T00:00:00.000Z",
      deleted: false,
      isAuthor: true,
      canEdit: true,
      canDelete: false,
      pending: false,
      updatedAt: null,
    };
    const view = renderComponent(
      <PostComments comments={[comment]} onEdit={onEdit} onDelete={onDelete} />,
    );

    press(/edit comment/i);
    expect(onEdit).toHaveBeenCalledWith("comment_test_1");
    expect(
      view.queryByRole("button", { name: /delete comment/i }),
    ).not.toBeInTheDocument();

    view.rerender(
      <PostComments
        comments={[{ ...comment, canEdit: false, canDelete: true }]}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    expect(
      view.queryByRole("button", { name: /edit comment/i }),
    ).not.toBeInTheDocument();
    press(/delete comment/i);
    expect(onDelete).toHaveBeenCalledWith("comment_test_1");
  });
});
