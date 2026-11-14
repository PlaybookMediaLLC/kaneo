import { fireEvent, waitFor } from "@testing-library/react";
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
    const toggle = view.getByRole("button", { name: "Add reaction" });
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-expanded", "false"),
    );
    expect(toggle).toHaveFocus();
  });

  it("closes the picker with Escape and returns focus", () => {
    const view = renderComponent(
      <CommentReactions reactions={reactions} onReact={vi.fn()} />,
    );
    press("Add reaction");
    const emoji = view.getByRole("button", { name: "React with 👀" });
    emoji.focus();
    fireEvent.keyDown(emoji, { key: "Escape" });
    expect(
      view.queryByRole("button", { name: "React with 👀" }),
    ).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Add reaction" })).toHaveFocus();
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
