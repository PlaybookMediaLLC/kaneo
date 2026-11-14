import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../test/actions";
import { renderComponent } from "../test/render";
import { ReactionBar } from "./reaction-bar";

const reactions = [
  { emoji: "🎉", count: 2, reacted: true },
  { emoji: "🚀", count: 1, reacted: false },
];

describe("ReactionBar", () => {
  it("names each reaction with its count and pressed state", () => {
    const view = renderComponent(
      <ReactionBar reactions={reactions} onReact={vi.fn()} />,
    );
    expect(view.getByRole("group", { name: "Reactions" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "🎉 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.getByRole("button", { name: "👍 0" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(view.getAllByRole("button")).toHaveLength(7);
  });

  it("adds and removes a reaction", () => {
    const onReact = vi.fn(async () => undefined);
    renderComponent(<ReactionBar reactions={reactions} onReact={onReact} />);
    press("🎉 2");
    press("👀 0");
    expect(onReact).toHaveBeenCalledWith("🎉", false);
    expect(onReact).toHaveBeenCalledWith("👀", true);
  });

  it("is read-only without a callback and hides unused emoji", () => {
    const view = renderComponent(<ReactionBar reactions={reactions} />);
    expect(view.getAllByRole("button")).toHaveLength(2);
    expect(view.getByRole("button", { name: "🚀 1" })).toBeDisabled();
    const empty = renderComponent(<ReactionBar reactions={[]} />);
    expect(empty.container).toBeEmptyDOMElement();
  });
});
