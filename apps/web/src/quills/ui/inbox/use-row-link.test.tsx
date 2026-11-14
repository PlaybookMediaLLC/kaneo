import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { useRowLink } from "./use-row-link";

function Row({ onOpen, selected }: { onOpen: () => void; selected?: boolean }) {
  return (
    <a
      href="/feedback/workspace_1/posts/post_1"
      {...useRowLink(onOpen, selected)}
    >
      Export fails
    </a>
  );
}

describe("useRowLink", () => {
  it("opens in the app on a plain click and leaves a modified click to the browser", () => {
    const onOpen = vi.fn();
    const view = renderComponent(<Row onOpen={onOpen} />);
    const link = view.getByRole("link");
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("marks and scrolls to the selected row", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const view = renderComponent(<Row onOpen={() => undefined} selected />);
    expect(view.getByRole("link")).toHaveAttribute("aria-current", "true");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });
});
