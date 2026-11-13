import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { CommentReactions } from "./comment-reactions";

const reactions = [
  { emoji: "❤️", count: 2, reacted: true },
  { emoji: "🚀", count: 1, reacted: false },
];

describe("CommentReactions", () => {
  it("toggles the like and an existing reaction", async () => {
    const onReact = vi.fn(async () => undefined);
    const view = renderComponent(
      <CommentReactions reactions={reactions} onReact={onReact} />,
    );
    expect(view.getByRole("button", { name: "Like" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    press("Like");
    press("🚀 1");
    expect(onReact).toHaveBeenCalledWith("❤️", false);
    expect(onReact).toHaveBeenCalledWith("🚀", true);
  });

  it("adds a new reaction from the picker", async () => {
    const onReact = vi.fn(async () => undefined);
    const view = renderComponent(
      <CommentReactions reactions={reactions} onReact={onReact} />,
    );
    press("Add reaction");
    press("React with 🎉");
    expect(onReact).toHaveBeenCalledWith("🎉", true);
    expect(
      await view.findByRole("button", { name: "Add reaction" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("is read-only for a visitor", () => {
    const view = renderComponent(<CommentReactions reactions={reactions} />);
    expect(view.getByRole("button", { name: "Like" })).toBeDisabled();
    expect(view.getByRole("button", { name: "🚀 1" })).toBeDisabled();
    expect(
      view.queryByRole("button", { name: "Add reaction" }),
    ).not.toBeInTheDocument();
  });
});
