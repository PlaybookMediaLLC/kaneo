import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostSidebar } from "./post-sidebar";

const props = {
  author: { name: "Morgan", avatarUrl: null },
  createdAt: "2026-01-01T00:00:00.000Z",
  status: { name: "Planned", color: "blue" },
  stage: "planned",
  board: { name: "Ideas", href: "/portal/workspace_test_1/boards/board_1" },
};

describe("PostSidebar", () => {
  it("shows the author and details and toggles follow", () => {
    const onFollowChange = vi.fn(async () => undefined);
    const onEdit = vi.fn();
    const view = renderComponent(
      <PostSidebar
        {...props}
        following={false}
        onFollowChange={onFollowChange}
        onEdit={onEdit}
      />,
    );
    expect(view.getByText("Morgan")).toBeInTheDocument();
    expect(view.getByText("Planned")).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Ideas" })).toHaveAttribute(
      "href",
      props.board.href,
    );
    press("Follow this post");
    expect(onFollowChange).toHaveBeenCalledWith(true);
    press("Edit post");
    expect(onEdit).toHaveBeenCalledOnce();
    expect(
      view.queryByRole("button", { name: "Delete post" }),
    ).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("sends a visitor to sign in to follow", () => {
    const view = renderComponent(
      <PostSidebar {...props} signInHref="/auth/sign-in?redirect=%2Fp" />,
    );
    expect(
      view.getByRole("link", { name: "Follow this post" }),
    ).toHaveAttribute("href", "/auth/sign-in?redirect=%2Fp");
  });
});
