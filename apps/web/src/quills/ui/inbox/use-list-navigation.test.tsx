import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { useListNavigation } from "./use-list-navigation";

const ids = ["a", "b", "c"];

function List({
  start = null,
  onOpen,
  onBack,
}: {
  start?: string | null;
  onOpen?: (id: string) => void;
  onBack?: () => void;
}) {
  const [active, setActive] = useState<string | null>(start);
  const { next, previous } = useListNavigation({
    ids,
    activeId: active,
    onMove: setActive,
    onOpen,
    onBack,
  });
  return (
    <>
      <ShortcutListener />
      <output>{active ?? "none"}</output>
      <input aria-label="Search" />
      <button type="button" onClick={next}>
        next
      </button>
      <button type="button" onClick={previous}>
        previous
      </button>
    </>
  );
}

const press = (key: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key });

describe("useListNavigation", () => {
  it("moves with J, K and the arrow keys and stops at both ends", () => {
    const view = renderComponent(<List />);
    const active = () => view.getByRole("status").textContent;
    press("j");
    expect(active()).toBe("a");
    press("ArrowDown");
    press("j");
    press("j");
    expect(active()).toBe("c");
    press("k");
    expect(active()).toBe("b");
    press("ArrowUp");
    press("ArrowUp");
    expect(active()).toBe("a");
  });

  it("starts from the last item with K and ignores keys in a text field", () => {
    const view = renderComponent(<List />);
    press("j", view.getByRole("textbox", { name: "Search" }));
    expect(view.getByRole("status")).toHaveTextContent("none");
    press("k");
    expect(view.getByRole("status")).toHaveTextContent("c");
  });

  it("opens the active item with Enter and goes back with Esc", () => {
    const onOpen = vi.fn();
    const onBack = vi.fn();
    renderComponent(<List start="b" onOpen={onOpen} onBack={onBack} />);
    press("Enter");
    expect(onOpen).toHaveBeenCalledWith("b");
    press("Escape");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("gives the same moves to buttons", () => {
    const view = renderComponent(<List start="a" />);
    fireEvent.click(view.getByRole("button", { name: "next" }));
    expect(view.getByRole("status")).toHaveTextContent("b");
    fireEvent.click(view.getByRole("button", { name: "previous" }));
    expect(view.getByRole("status")).toHaveTextContent("a");
  });
});
