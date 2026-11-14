import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { ListHeader } from "./list-header";

describe("ListHeader", () => {
  it("shows the heading and opens filters and display by button and by key", () => {
    const onFilters = vi.fn();
    const onDisplay = vi.fn();
    const view = renderComponent(
      <>
        <ShortcutListener />
        <ListHeader
          title="All conversations"
          onFilters={onFilters}
          onDisplay={onDisplay}
        />
      </>,
    );
    expect(
      view.getByRole("heading", { level: 1, name: "All conversations" }),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Filters" })).toHaveAttribute(
      "aria-keyshortcuts",
      "F",
    );
    press("Filters");
    press("Display");
    fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
    fireEvent.keyDown(document.body, { key: "v", code: "KeyV" });
    expect(onFilters).toHaveBeenCalledTimes(2);
    expect(onDisplay).toHaveBeenCalledTimes(2);
  });

  it("leaves out a control without a handler and shows extra actions", () => {
    const view = renderComponent(
      <ListHeader
        title="Tickets"
        headingLevel={2}
        actions={<button type="button">New</button>}
      />,
    );
    expect(
      view.getByRole("heading", { level: 2, name: "Tickets" }),
    ).toBeVisible();
    expect(view.queryByRole("button", { name: "Filters" })).toBeNull();
    expect(view.queryByRole("button", { name: "Display" })).toBeNull();
    expect(view.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
